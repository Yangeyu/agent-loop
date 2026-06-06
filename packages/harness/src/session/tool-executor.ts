import {
  createRunningToolPart,
  toCompletedToolPart,
  toErroredToolPart,
  toMetadataPatchedToolPart,
  toRunningToolPart,
} from "@harness/session/tool-part"
import { isAbortError, isDoomLoop } from "@harness/session/retry"
import type { ProcessorContext, ToolExecutionResult } from "@harness/session/processor-context"
import { TurnLifecycle } from "@harness/session/turn-lifecycle"
import { toToolExecutionErrorInfo } from "@harness/tool/tool"
import { createID, type ErrorInfo, type SessionHistoryMessage, type ToolContext, type ToolDefinition, type ToolPart } from "@harness/types"

export class ToolCallExecutor {
  constructor(private readonly context: ProcessorContext, private readonly lifecycle: TurnLifecycle) {}

  async execute(chunk: { toolCallId: string; toolName: string; args: unknown }): Promise<ToolExecutionResult> {
    const outcome = await this.executeCall(chunk)
    return outcome.kind === "stop" ? { kind: "stop" } : { kind: "continue" }
  }

  private getToolEventBase(tool: string, toolCallId: string) {
    return {
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      tool,
      toolCallId,
    }
  }

  private stopTurn(error: ErrorInfo, text: string) {
    this.lifecycle.fail(error)
    this.context.session_store.appendTextPart(this.context.session.id, this.context.assistant.id, {
      id: createID(),
      type: "text",
      text,
      synthetic: true,
    })
    return { kind: "stop" } as const
  }

  private async executeCall(chunk: { toolCallId: string; toolName: string; args: unknown }): Promise<
    | { kind: "completed"; result: Awaited<ReturnType<ToolDefinition<unknown>["execute"]>> }
    | { kind: "error"; error: ErrorInfo }
    | { kind: "stop" }
  > {
    this.lifecycle.enterPhase("executing-tool")

    this.context.events.emit({
      type: "tool-call",
      ...this.getToolEventBase(chunk.toolName, chunk.toolCallId),
      args: chunk.args,
    })

    this.context.events.emit({
      type: "tool-start",
      ...this.getToolEventBase(chunk.toolName, chunk.toolCallId),
    })

    this.context.reasoningPart = undefined
    this.context.textPart = undefined

    const part = this.context.session_store.startToolPart(this.context.session.id, this.context.assistant.id, {
      ...createRunningToolPart({
        id: createID(),
        toolName: chunk.toolName,
        toolCallId: chunk.toolCallId,
        input: chunk.args,
        startedAt: Date.now(),
      }),
    })

    this.context.toolCalls += 1
    if (this.context.toolCalls > this.context.policy.budget.maxToolCalls) {
      this.context.events.emit({
        type: "budget-hit",
        sessionID: this.context.session.id,
        agent: this.context.agent.name,
        budget: "tool_calls",
        detail: "Tool call budget exceeded for turn",
        limit: this.context.policy.budget.maxToolCalls,
        used: this.context.toolCalls,
      })
      this.markToolPartError(part, chunk.args, {
        message: `Tool call budget exceeded for turn (${this.context.policy.budget.maxToolCalls})`,
        retryable: false,
        code: "tool_budget_exceeded",
      })
      return this.stopTurn({
        message: `Tool call budget exceeded for turn (${this.context.policy.budget.maxToolCalls})`,
        retryable: false,
        code: "tool_budget_exceeded",
      }, "\n\n[Stopped: tool call budget exceeded]")
    }

    const tool = this.context.tools.find((item) => item.id === chunk.toolName)
    if (!tool) {
      const error = {
        message: `Tool not available: ${chunk.toolName}`,
        retryable: false,
        code: "tool_not_available",
      } satisfies ErrorInfo
      this.markToolPartError(part, chunk.args, error)
      return this.resolveToolFailure(chunk.toolName, error)
    }

    const parsedCall = tool.validate(chunk.args)
    if (!parsedCall.success) {
      this.markToolPartError(part, chunk.args, parsedCall.error)
      return this.resolveToolFailure(chunk.toolName, parsedCall.error)
    }

    const validatedArgs = parsedCall.data
    this.updateRunningToolPart(part, validatedArgs)

    if (isDoomLoop(this.context.recentToolCalls, chunk.toolName, validatedArgs)) {
      this.markToolPartError(part, validatedArgs, {
        message: `Potential doom loop detected for tool ${chunk.toolName}`,
        retryable: false,
        code: "doom_loop",
      })
      return this.stopTurn({
        message: `Potential doom loop detected for tool ${chunk.toolName}`,
        retryable: false,
        code: "doom_loop",
      }, "\n\n[Stopped: repeated identical tool calls detected]")
    }

    this.context.recentToolCalls.push({
      toolName: chunk.toolName,
      args: validatedArgs,
    })

    try {
      const toolResult = await tool.execute(validatedArgs, this.createToolContext(part))
      this.completeToolPart(part, validatedArgs, toolResult)

      this.context.events.emit({
        type: "tool-result",
        ...this.getToolEventBase(chunk.toolName, chunk.toolCallId),
        output: toolResult.output,
        title: toolResult.title,
        metadata: toolResult.metadata,
        attachments: toolResult.attachments,
      })

      this.context.recentToolFailures = []
      return { kind: "completed", result: toolResult }
    } catch (error) {
      if (isAbortError(error)) {
        this.context.session_store.updatePart(this.context.session.id, this.context.assistant.id, part.id, toErroredToolPart(part, validatedArgs, {
          message: "Aborted",
          retryable: false,
          code: "aborted",
        }))
        this.context.events.emit({
          type: "tool-error",
          ...this.getToolEventBase(chunk.toolName, chunk.toolCallId),
          error: "Aborted",
          errorInfo: {
            message: "Aborted",
            retryable: false,
            code: "aborted",
          },
        })
        this.lifecycle.abort()
        return { kind: "stop" }
      }

      const errorInfo = toToolExecutionErrorInfo(chunk.toolName, error)
      this.markToolPartError(part, validatedArgs, errorInfo)
      return this.resolveToolFailure(chunk.toolName, errorInfo)
    }
  }

  private resolveToolFailure(toolName: string, error: ErrorInfo):
    | { kind: "error"; error: ErrorInfo }
    | { kind: "stop" } {
    if (!this.shouldStopForRepeatedToolFailures()) return { kind: "error", error }

    this.context.events.emit({
      type: "budget-hit",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      budget: "tool_failures",
      detail: `Repeated identical tool failures detected for ${toolName}`,
      limit: this.context.policy.budget.repeatedToolFailureThreshold,
      used: this.context.policy.budget.repeatedToolFailureThreshold,
    })

    return this.stopTurn({
      message: `Repeated identical tool failures detected for ${toolName}`,
      retryable: false,
      code: "repeated_tool_failure",
    }, "\n\n[Stopped: repeated identical tool failures detected]")
  }

  private markToolPartError(part: ToolPart, input: unknown, error: ErrorInfo) {
    const latestPart = this.getLatestToolPart(part) ?? part

    this.context.recentToolFailures.push({
      toolName: latestPart.toolName,
      input,
      error: error.message,
    })

    this.context.session_store.updatePart(
      this.context.session.id,
      this.context.assistant.id,
      part.id,
      toErroredToolPart(latestPart, input, error),
    )
    this.context.events.emit({
      type: "tool-error",
      ...this.getToolEventBase(latestPart.toolName, latestPart.toolCallId),
      error: error.message,
      errorInfo: error,
    })
  }

  private updateRunningToolPart(part: ToolPart, input: unknown) {
    this.context.session_store.updatePart(this.context.session.id, this.context.assistant.id, part.id, toRunningToolPart(part, input))
  }

  private completeToolPart(
    part: ToolPart,
    input: unknown,
    result: Awaited<ReturnType<ToolDefinition<unknown>["execute"]>>,
  ) {
    const latestPart = this.getLatestToolPart(part) ?? part

    this.context.session_store.updatePart(
      this.context.session.id,
      this.context.assistant.id,
      part.id,
      toCompletedToolPart(latestPart, input, result),
    )
  }

  private getLatestToolPart(part: ToolPart) {
    return this.context.session_store.getParts(this.context.session.id, this.context.assistant.id).find(
      (item): item is ToolPart => item.id === part.id && item.type === "tool",
    )
  }

  private shouldStopForRepeatedToolFailures() {
    const threshold = this.context.policy.budget.repeatedToolFailureThreshold
    const recentFailures = this.context.recentToolFailures.slice(-threshold)
    if (recentFailures.length < threshold) return false

    const [firstFailure, ...restFailures] = recentFailures
    const signature = JSON.stringify(firstFailure)
    return restFailures.every((failure) => JSON.stringify(failure) === signature)
  }

  private createToolContext(part: ToolPart): ToolContext {
    const context = this.context
    const lifecycle = this.lifecycle

    return {
      config: context.config,
      sessionID: context.session.id,
      messageID: context.assistant.parentID,
      turnID: context.assistant.id,
      agent: context.agent.name,
      abort: context.abort,
      events: context.events,
      toolCallId: part.toolCallId,
      format: context.user.format,
      messages: this.collectSessionHistory(),
      extra: {
        model: context.user.model,
      },
      session_store: context.session_store,
      agent_registry: context.agent_registry,
      skill_registry: context.skill_registry,
      tool_registry: context.tool_registry,
      metadata: async (metadataUpdate: { title?: string; metadata?: Record<string, unknown> }) => {
        const latest = this.getLatestToolPart(part)
        if (!latest) return

        context.session_store.updatePart(
          context.session.id,
          context.assistant.id,
          part.id,
          toMetadataPatchedToolPart(latest, {
            title: metadataUpdate.title,
            metadata: metadataUpdate.metadata,
          }),
        )

        context.events.emit({
          type: "tool-metadata",
          ...this.getToolEventBase(latest.toolName, latest.toolCallId),
          title: metadataUpdate.title,
          metadata: metadataUpdate.metadata,
        })
      },
      executeTool: async (input: { toolName: string; args: unknown; toolCallId?: string }) => {
        const outcome = await this.executeCall({
          toolName: input.toolName,
          args: input.args,
          toolCallId: input.toolCallId ?? createID(),
        })

        if (outcome.kind === "completed") {
          return {
            status: "completed" as const,
            result: outcome.result,
          }
        }

        if (outcome.kind === "error") {
          return {
            status: "error" as const,
            error: outcome.error,
          }
        }

        throw new Error(`Nested tool execution stopped while running ${input.toolName}`)
      },
    }
  }

  private collectSessionHistory(): SessionHistoryMessage[] {
    const session = this.context.session_store.get(this.context.session.id)
    return session.messages.map((message) => ({
      info: message,
      parts: this.context.session_store.getParts(this.context.session.id, message.id),
    }))
  }
}

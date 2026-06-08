/**
 * Tool dispatch: validate -> execute -> persist result/error -> emit events.
 * Contains NO business policy. Budgets, doom-loop and repeated-failure guards
 * are middleware (beforeToolCall / onToolError); rewriting is afterToolCall.
 */
import { appendStopNote, StreamSink } from "@harness/core/stream-sink"
import type { TurnContext } from "@harness/core/context"
import type { MiddlewareStack } from "@harness/hooks/stack"
import type { ToolCall } from "@harness/hooks/types"
import { isAbortError } from "@harness/core/retry"
import {
  createRunningToolPart,
  toCompletedToolPart,
  toErroredToolPart,
  toMetadataPatchedToolPart,
  toRunningToolPart,
} from "@harness/session/tool-part"
import { toToolExecutionErrorInfo } from "@harness/tool/tool"
import {
  createID,
  type ErrorInfo,
  type SessionHistoryMessage,
  type ToolContext,
  type ToolExecuteResult,
  type ToolPart,
} from "@harness/types"

type GuardedToolResult =
  | { status: "completed"; result: ToolExecuteResult }
  | { status: "error"; error: ErrorInfo }
  | { status: "stop"; error: ErrorInfo; note?: string }
  | { status: "abort" }

/** Whether the loop should continue after a tool call, or stop the turn. */
export type ToolDispatchResult = { kind: "continue" } | { kind: "stop" }

/**
 * Dispatches a single tool call from the stream: runs it through the guard/execute
 * pipeline, drives the sink's phase, and translates a guard stop/abort into a turn
 * stop (failing the sink and appending a stop note).
 *
 * @param ctx - the turn context
 * @param stack - the middleware stack (before/after/onError tool hooks)
 * @param sink - the stream sink for phase + terminal transitions
 * @param chunk - the tool-call chunk (name, call id, args)
 * @returns whether to continue the turn or stop it
 */
export async function dispatchToolCall(
  ctx: TurnContext,
  stack: MiddlewareStack,
  sink: StreamSink,
  chunk: { toolName: string; toolCallId: string; args: unknown },
): Promise<ToolDispatchResult> {
  sink.enterPhase("executing-tool")

  const outcome = await runGuardedTool(ctx, stack, {
    toolName: chunk.toolName,
    toolCallId: chunk.toolCallId,
    args: chunk.args,
  })

  if (outcome.status === "completed" || outcome.status === "error") return { kind: "continue" }
  if (outcome.status === "abort") {
    sink.abort()
    return { kind: "stop" }
  }

  sink.fail(outcome.error)
  appendStopNote(ctx, outcome.note ?? `\n\n[Stopped: ${outcome.error.message}]`)
  return { kind: "stop" }
}

async function runGuardedTool(ctx: TurnContext, stack: MiddlewareStack, call: ToolCall): Promise<GuardedToolResult> {
  const base = toolEventBase(ctx, call.toolName, call.toolCallId)
  ctx.events.emit({ type: "tool-call", ...base, args: call.args })
  ctx.events.emit({ type: "tool-start", ...base })

  ctx.reasoningPart = undefined
  ctx.textPart = undefined

  const part = ctx.session_store.startToolPart(
    ctx.sessionID,
    ctx.assistant.id,
    createRunningToolPart({
      id: createID(),
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      input: call.args,
      startedAt: Date.now(),
    }),
  )

  ctx.toolCalls += 1

  const gate = await stack.beforeToolCall(ctx, call)
  if (gate.action === "deny") {
    markToolPartError(ctx, part, call.args, gate.error)
    return { status: "stop", error: gate.error, note: gate.note }
  }
  const args = gate.args ?? call.args

  const tool = ctx.tools.find((item) => item.id === call.toolName)
  if (!tool) {
    const error: ErrorInfo = { message: `Tool not available: ${call.toolName}`, retryable: false, code: "tool_not_available" }
    markToolPartError(ctx, part, call.args, error)
    return resolveToolError(ctx, stack, call, error)
  }

  const parsed = tool.validate(args)
  if (!parsed.success) {
    markToolPartError(ctx, part, args, parsed.error)
    return resolveToolError(ctx, stack, call, parsed.error)
  }

  const validatedArgs = parsed.data
  updateRunningToolPart(ctx, part, validatedArgs)

  try {
    const raw = await tool.execute(validatedArgs, createToolContext(ctx, stack, part))
    const result = await stack.afterToolCall(ctx, { ...call, args: validatedArgs }, raw)
    completeToolPart(ctx, part, validatedArgs, result)
    ctx.events.emit({
      type: "tool-result",
      ...base,
      output: result.output,
      title: result.title,
      metadata: result.metadata,
      attachments: result.attachments,
    })
    return { status: "completed", result }
  } catch (error) {
    if (isAbortError(error)) {
      const aborted: ErrorInfo = { message: "Aborted", retryable: false, code: "aborted" }
      ctx.session_store.updatePart(
        ctx.sessionID,
        ctx.assistant.id,
        part.id,
        toErroredToolPart(getLatestToolPart(ctx, part) ?? part, validatedArgs, aborted),
      )
      ctx.events.emit({ type: "tool-error", ...base, error: "Aborted", errorInfo: aborted })
      return { status: "abort" }
    }

    const errorInfo = toToolExecutionErrorInfo(call.toolName, error)
    markToolPartError(ctx, part, validatedArgs, errorInfo)
    return resolveToolError(ctx, stack, call, errorInfo)
  }
}

async function resolveToolError(
  ctx: TurnContext,
  stack: MiddlewareStack,
  call: ToolCall,
  error: ErrorInfo,
): Promise<GuardedToolResult> {
  const decision = await stack.onToolError(ctx, call, error)
  if (decision.action === "stop") return { status: "stop", error: decision.error, note: decision.note }
  return { status: "error", error }
}

function toolEventBase(ctx: TurnContext, tool: string, toolCallId: string) {
  return {
    sessionID: ctx.sessionID,
    agent: ctx.agent.name,
    messageID: ctx.assistant.parentID,
    turnID: ctx.assistant.id,
    tool,
    toolCallId,
  }
}

function markToolPartError(ctx: TurnContext, part: ToolPart, input: unknown, error: ErrorInfo) {
  const latest = getLatestToolPart(ctx, part) ?? part
  ctx.session_store.updatePart(ctx.sessionID, ctx.assistant.id, part.id, toErroredToolPart(latest, input, error))
  ctx.events.emit({
    type: "tool-error",
    ...toolEventBase(ctx, latest.toolName, latest.toolCallId),
    error: error.message,
    errorInfo: error,
  })
}

function updateRunningToolPart(ctx: TurnContext, part: ToolPart, input: unknown) {
  ctx.session_store.updatePart(ctx.sessionID, ctx.assistant.id, part.id, toRunningToolPart(part, input))
}

function completeToolPart(ctx: TurnContext, part: ToolPart, input: unknown, result: ToolExecuteResult) {
  const latest = getLatestToolPart(ctx, part) ?? part
  ctx.session_store.updatePart(ctx.sessionID, ctx.assistant.id, part.id, toCompletedToolPart(latest, input, result))
}

function getLatestToolPart(ctx: TurnContext, part: ToolPart) {
  return ctx.session_store
    .getParts(ctx.sessionID, ctx.assistant.id)
    .find((item): item is ToolPart => item.id === part.id && item.type === "tool")
}

function createToolContext(ctx: TurnContext, stack: MiddlewareStack, part: ToolPart): ToolContext {
  return {
    config: ctx.config,
    agent_registry: ctx.agent_registry,
    skill_registry: ctx.skill_registry,
    session_store: ctx.session_store,
    tool_registry: ctx.tool_registry,
    events: ctx.events,
    sessionID: ctx.sessionID,
    messageID: ctx.assistant.parentID,
    turnID: ctx.assistant.id,
    agent: ctx.agent.name,
    abort: ctx.abort,
    toolCallId: part.toolCallId,
    format: ctx.user.format,
    messages: collectSessionHistory(ctx),
    extra: { model: ctx.user.model },
    metadata: async (metadataUpdate: { title?: string; metadata?: Record<string, unknown> }) => {
      const latest = getLatestToolPart(ctx, part)
      if (!latest) return

      ctx.session_store.updatePart(
        ctx.sessionID,
        ctx.assistant.id,
        part.id,
        toMetadataPatchedToolPart(latest, { title: metadataUpdate.title, metadata: metadataUpdate.metadata }),
      )

      ctx.events.emit({
        type: "tool-metadata",
        ...toolEventBase(ctx, latest.toolName, latest.toolCallId),
        title: metadataUpdate.title,
        metadata: metadataUpdate.metadata,
      })
    },
    executeTool: async (input: { toolName: string; args: unknown; toolCallId?: string }) => {
      const outcome = await runGuardedTool(ctx, stack, {
        toolName: input.toolName,
        args: input.args,
        toolCallId: input.toolCallId ?? createID(),
      })

      if (outcome.status === "completed") return { status: "completed" as const, result: outcome.result }
      if (outcome.status === "error" || outcome.status === "stop") {
        return { status: "error" as const, error: outcome.error }
      }
      throw new Error(`Nested tool execution aborted while running ${input.toolName}`)
    },
  }
}

function collectSessionHistory(ctx: TurnContext): SessionHistoryMessage[] {
  const session = ctx.session_store.get(ctx.sessionID)
  return session.messages.map((message) => ({
    info: message,
    parts: ctx.session_store.getParts(ctx.sessionID, message.id),
  }))
}

/**
 * Tool dispatch: validate -> execute -> persist result/error. Contains NO
 * business policy — budgets, doom-loop and repeated-failure guards are
 * middleware (beforeToolCall / onToolError); rewriting is afterToolCall.
 *
 * Dispatch emits no events of its own: every observable fact of a call is a
 * tool-part state transition written through the tracker, and the state channel
 * carries those automatically (part.created / part.updated).
 */
import type { TurnContext } from "@harness/core/context"
import type { TurnRecorder } from "@harness/core/recorder"
import type { MiddlewareStack } from "@harness/hooks/stack"
import type { ToolCall } from "@harness/hooks/types"
import { isAbortError } from "@harness/core/retry"
import type { ToolPartTracker } from "@harness/core/tool-part"
import { toToolExecutionErrorInfo } from "@harness/tool/tool"
import {
  createID,
  type ErrorInfo,
  type SessionHistoryMessage,
  type ToolContext,
  type ToolExecuteResult,
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
 * pipeline, drives the turn phase, and translates a guard stop/abort into a turn
 * stop (failing the recorder and appending a stop note).
 *
 * @param ctx - the turn context
 * @param stack - the middleware stack (before/after/onError tool hooks)
 * @param recorder - the turn recorder (phase + tool parts + terminal transitions)
 * @param chunk - the tool-call chunk (name, call id, args)
 * @returns whether to continue the turn or stop it
 */
export async function dispatchToolCall(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  chunk: { toolName: string; toolCallId: string; args: unknown },
): Promise<ToolDispatchResult> {
  recorder.enterPhase("executing-tool")

  const outcome = await runGuardedTool(ctx, stack, recorder, {
    toolName: chunk.toolName,
    toolCallId: chunk.toolCallId,
    args: chunk.args,
  })

  if (outcome.status === "completed" || outcome.status === "error") return { kind: "continue" }
  if (outcome.status === "abort") {
    recorder.abort()
    return { kind: "stop" }
  }

  recorder.fail(outcome.error)
  recorder.appendNote(outcome.note ?? `\n\n[Stopped: ${outcome.error.message}]`)
  return { kind: "stop" }
}

async function runGuardedTool(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  call: ToolCall,
): Promise<GuardedToolResult> {
  const tracker = recorder.trackToolCall(call)

  const gate = await stack.beforeToolCall(ctx, call)
  if (gate.action === "deny") {
    tracker.toErrored(call.args, gate.error)
    return { status: "stop", error: gate.error, note: gate.note }
  }
  const args = gate.args ?? call.args

  const tool = ctx.tools.find((item) => item.id === call.toolName)
  if (!tool) {
    const error: ErrorInfo = { message: `Tool not available: ${call.toolName}`, retryable: false, code: "tool_not_available" }
    tracker.toErrored(call.args, error)
    return resolveToolError(ctx, stack, call, error)
  }

  const parsed = tool.validate(args)
  if (!parsed.success) {
    tracker.toErrored(args, parsed.error)
    return resolveToolError(ctx, stack, call, parsed.error)
  }

  const validatedArgs = parsed.data
  tracker.toRunning(validatedArgs)

  try {
    const raw = await tool.execute(validatedArgs, createToolContext(ctx, stack, recorder, tracker))
    const result = await stack.afterToolCall(ctx, { ...call, args: validatedArgs }, raw)
    tracker.toCompleted(validatedArgs, result)
    return { status: "completed", result }
  } catch (error) {
    if (isAbortError(error)) {
      tracker.toErrored(validatedArgs, { message: "Aborted", retryable: false, code: "aborted" })
      return { status: "abort" }
    }

    const errorInfo = toToolExecutionErrorInfo(call.toolName, error)
    tracker.toErrored(validatedArgs, errorInfo)
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

function createToolContext(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  tracker: ToolPartTracker,
): ToolContext {
  return {
    config: ctx.config,
    agent_registry: ctx.agent_registry,
    skill_registry: ctx.skill_registry,
    sessions: ctx.sessions,
    tool_registry: ctx.tool_registry,
    events: ctx.events,
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    agent: ctx.agent.name,
    abort: ctx.abort,
    toolCallId: tracker.part.toolCallId,
    format: ctx.user.format,
    messages: collectSessionHistory(ctx),
    metadata: async (update: { title?: string; metadata?: Record<string, unknown> }) => {
      tracker.patchMetadata({ title: update.title, metadata: update.metadata })
    },
    executeTool: async (input: { toolName: string; args: unknown; toolCallId?: string }) => {
      const outcome = await runGuardedTool(ctx, stack, recorder, {
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
  const session = ctx.sessions.get(ctx.sessionID)
  return session.messages.map((message) => ({
    info: message,
    parts: ctx.sessions.parts(ctx.sessionID, message.id),
  }))
}

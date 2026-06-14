/**
 * Per-call tool execution: validate -> execute -> persist result/error, returning
 * a per-call outcome. This is the concurrency-safe unit a turn fans out: it owns
 * only its own tool part (via the injected tracker) and never touches the turn's
 * terminal state — collecting outcomes and deciding the turn's continue/stop is
 * the caller's job (see core/turn.ts). Contains NO business policy — budgets,
 * doom-loop and repeated-failure guards are middleware (beforeToolCall /
 * onToolError); rewriting is afterToolCall.
 *
 * Execution emits no events of its own: every observable fact of a call is a
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

/**
 * The result of running one tool call to completion: a successful result, a
 * recoverable error (the turn continues), a stop signal (a guard/onToolError
 * decided the turn must halt), or an abort. The caller reduces a batch of these
 * into the turn's single terminal decision.
 */
export type ToolCallOutcome =
  | { status: "completed"; result: ToolExecuteResult }
  | { status: "error"; error: ErrorInfo }
  | { status: "stop"; error: ErrorInfo; note?: string }
  | { status: "abort" }

/**
 * Runs a single tool call through the guard/execute pipeline against a
 * pre-allocated tool part, returning its per-call outcome. Writes only this
 * call's part state (via the tracker); it never mutates the turn's terminal
 * state, so N calls can run concurrently and the caller decides the turn's fate
 * once they all settle.
 *
 * @param ctx - the turn context
 * @param stack - the middleware stack (before/after/onError tool hooks)
 * @param recorder - the turn recorder (used only to spawn nested tool parts)
 * @param call - the tool name, call id, and raw args
 * @param tracker - the tool part this call owns, pre-created by the caller
 * @returns the per-call outcome
 */
export async function executeToolCall(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  call: ToolCall,
  tracker: ToolPartTracker,
): Promise<ToolCallOutcome> {
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
): Promise<ToolCallOutcome> {
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
      const nestedCall: ToolCall = {
        toolName: input.toolName,
        args: input.args,
        toolCallId: input.toolCallId ?? createID(),
      }
      const nestedTracker = recorder.trackToolCall(nestedCall)
      const outcome = await executeToolCall(ctx, stack, recorder, nestedCall, nestedTracker)

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

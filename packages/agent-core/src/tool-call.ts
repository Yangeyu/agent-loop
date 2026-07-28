/**
 * Per-call tool execution, in two halves. `prepareToolCall` decides — gate,
 * validate, describe — one call at a time in issue order. `executeToolCall`
 * runs, and is the concurrency-safe unit a turn fans out: it owns
 * only its own tool part (via the injected tracker) and never touches the turn's
 * terminal state — collecting outcomes and deciding the turn's continue/stop is
 * the caller's job (see core/turn.ts). Contains NO business policy — budgets and
 * doom-loop guards are beforeToolCall middleware; result rewriting and failure
 * escalation are afterToolCall middleware.
 *
 * Execution emits no events of its own: every observable fact of a call is a
 * tool-part state transition written through the tracker, and the state channel
 * carries those automatically (part.created / part.updated).
 */
import type { TurnContext } from "@agent-core/context"
import type { TurnRecorder } from "@agent-core/recorder"
import type { MiddlewareStack, ToolCall } from "@agent-core/hooks"
import { isAbortError } from "@agent-core/error"
import type { ToolPartTracker } from "@agent-core/tool-part"
import { toToolExecutionErrorInfo } from "@agent-core/tool/tool"
import {
  createID,
  type AnyToolDefinition,
  type ErrorInfo,
  type SessionHistoryMessage,
  type ToolContext,
  type ToolDisplayPatch,
  type ToolExecuteResult,
} from "@agent-core/types"

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
 * The ordered half of a call: everything that decides *whether* and *what*,
 * before anything is written or run. Returns either a call ready to execute —
 * with its validated args and the display naming it — or the refusal itself.
 *
 * Runs one call at a time, in issue order: a guard that counts (budget,
 * doom-loop) is only correct when calls reach it in sequence, and the display
 * must exist before the tool part is opened. Concurrency belongs to execute().
 *
 * @param ctx - the turn context
 * @param stack - the middleware stack (its beforeToolCall gate runs here)
 * @param call - the tool name, call id, and raw args
 * @returns the prepared call, or the refusal that ends it
 */
export async function prepareToolCall(
  ctx: TurnContext,
  stack: MiddlewareStack,
  call: ToolCall,
): Promise<PreparedToolCall> {
  const gate = await stack.beforeToolCall(ctx, call)
  if (gate.action === "deny") {
    return { ok: false, args: call.args, error: gate.error, stop: true, note: gate.note }
  }
  const args = gate.args ?? call.args

  const tool = ctx.tools.find((item) => item.id === call.toolName)
  if (!tool) {
    return {
      ok: false,
      args: call.args,
      error: { message: `Tool not available: ${call.toolName}`, retryable: false, code: "tool_not_available" },
    }
  }

  const parsed = tool.validate(args)
  if (!parsed.success) return { ok: false, args, error: parsed.error }

  return {
    ok: true,
    tool,
    args: parsed.data,
    display: tool.describe?.(parsed.data),
  }
}

/** A call that passed its gate and validation, or the refusal that ended it. */
export type PreparedToolCall =
  | { ok: true; tool: AnyToolDefinition; args: unknown; display?: ToolDisplayPatch }
  | { ok: false; args: unknown; error: ErrorInfo; stop?: boolean; note?: string }

/**
 * Opens the tool part a prepared call will report through — with its validated
 * args and its display already in place. Because preparation happens first,
 * the part is born in its final shape and `part.created` is immediately usable
 * by anything rendering the call.
 *
 * @param recorder - the turn recorder that owns part creation
 * @param call - the tool name, call id, and raw args
 * @param prepared - the result of prepareToolCall
 * @returns the tracker for this call's part
 */
export function openToolPart(recorder: TurnRecorder, call: ToolCall, prepared: PreparedToolCall) {
  return recorder.trackToolCall(
    { ...call, args: prepared.ok ? prepared.args : call.args },
    prepared.ok ? prepared.display : undefined,
  )
}

/**
 * Runs a prepared call to completion against its pre-allocated tool part. This
 * is the concurrent half: it writes only this call's part state (via the
 * tracker) and never touches the turn's terminal state, so N calls run at once
 * and the caller decides the turn's fate after they all settle.
 *
 * @param ctx - the turn context
 * @param stack - the middleware stack (after/onError tool hooks)
 * @param recorder - the turn recorder (used only to spawn nested tool parts)
 * @param call - the tool name, call id, and raw args
 * @param tracker - the tool part this call owns, opened by the caller
 * @param prepared - the outcome of prepareToolCall: a ready call or its refusal
 * @returns the per-call outcome
 */
export async function executeToolCall(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  call: ToolCall,
  tracker: ToolPartTracker,
  prepared: PreparedToolCall,
): Promise<ToolCallOutcome> {
  if (!prepared.ok) {
    if (prepared.stop) {
      tracker.toErrored(prepared.args, prepared.error)
      return { status: "stop", error: prepared.error, note: prepared.note }
    }
    return settleFailure(ctx, stack, call, tracker, prepared.args, prepared.error)
  }

  const { tool, args: validatedArgs } = prepared

  try {
    const raw = await tool.execute(validatedArgs, createToolContext(ctx, stack, recorder, tracker))
    const settled = await stack.afterToolCall(ctx, { ...call, args: validatedArgs }, { ok: true, result: raw })
    if (!settled.ok) {
      tracker.toErrored(validatedArgs, settled.error)
      if (settled.stop) return { status: "stop", error: settled.error, note: settled.note }
      return { status: "error", error: settled.error }
    }
    tracker.toCompleted(validatedArgs, settled.result)
    return { status: "completed", result: settled.result }
  } catch (error) {
    if (isAbortError(error)) {
      tracker.toErrored(validatedArgs, { message: "Aborted", retryable: false, code: "aborted" })
      return { status: "abort" }
    }

    return settleFailure(ctx, stack, call, tracker, validatedArgs, toToolExecutionErrorInfo(call.toolName, error))
  }
}

// Runs a failure through afterToolCall, then writes the part's terminal state
// with whatever the stack settled on — the part records the post-middleware
// truth, and a stop escalation halts the turn.
async function settleFailure(
  ctx: TurnContext,
  stack: MiddlewareStack,
  call: ToolCall,
  tracker: ToolPartTracker,
  args: unknown,
  error: ErrorInfo,
): Promise<ToolCallOutcome> {
  const settled = await stack.afterToolCall(ctx, call, { ok: false, error })
  if (settled.ok) {
    tracker.toCompleted(args, settled.result)
    return { status: "completed", result: settled.result }
  }
  tracker.toErrored(args, settled.error)
  if (settled.stop) return { status: "stop", error: settled.error, note: settled.note }
  return { status: "error", error: settled.error }
}

function createToolContext(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  tracker: ToolPartTracker,
): ToolContext {
  return {
    config: ctx.config,
    sessions: ctx.sessions,
    events: ctx.events,
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    agent: ctx.agent.name,
    abort: ctx.abort,
    toolCallId: tracker.part.toolCallId,
    format: ctx.user.format,
    messages: collectSessionHistory(ctx),
    metadata: async (update: { display?: ToolDisplayPatch; metadata?: Record<string, unknown> }) => {
      tracker.patchMetadata({ display: update.display, metadata: update.metadata })
    },
    executeTool: async (input: { toolName: string; args: unknown; toolCallId?: string }) => {
      const nestedCall: ToolCall = {
        toolName: input.toolName,
        args: input.args,
        toolCallId: input.toolCallId ?? createID(),
      }
      const nestedPrepared = await prepareToolCall(ctx, stack, nestedCall)
      const nestedTracker = openToolPart(recorder, nestedCall, nestedPrepared)
      const outcome = await executeToolCall(ctx, stack, recorder, nestedCall, nestedTracker, nestedPrepared)

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

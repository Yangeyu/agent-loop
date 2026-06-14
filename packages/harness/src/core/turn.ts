/**
 * runTurn: a single model turn. Wraps the stream in retry, accumulates output
 * through the TurnRecorder, runs the turn's tool calls, and finalizes via the
 * onTurnFinish hook. Aborts and stream failures are absorbed into the recorder
 * (its terminal transition) so the loop can decide what to do next.
 *
 * Tool calls are collected as they stream, then executed as one bounded-concurrency
 * batch once the stream drains (the provider emits all calls before `finish`, so
 * the batch is the whole turn's tool set). This file is the sole owner of the
 * turn's terminal state: per-call execution (core/tool-call.ts) is pure, and the
 * batch's outcomes are reduced here into a single continue/stop decision.
 */
import type { TurnContext } from "@harness/core/context"
import type { TurnRecorder } from "@harness/core/recorder"
import { executeToolCall, type ToolCallOutcome } from "@harness/core/tool-call"
import type { MiddlewareStack } from "@harness/hooks/stack"
import type { ToolCall } from "@harness/hooks/types"
import type { LLMInput, ModelMessage } from "@harness/llm/types"
import { classifyRetry, isAbortError, retry, retryDelay, toErrorInfo } from "@harness/core/retry"
import type { FinishReason } from "@harness/types"

/** The assembled model input for one turn: system fragments + transformed messages. */
export type TurnInput = {
  system: string[]
  messages: ModelMessage[]
}

/**
 * Runs one model turn: streams (with retry) into the recorder, dispatching tool
 * calls and finalizing on finish.
 *
 * @param ctx - the immutable turn context
 * @param stack - the agent's middleware stack, for the per-turn hooks
 * @param recorder - the turn recorder owning accumulation and terminal state
 * @param input - the assembled system fragments and model messages
 * @returns whether the turn issued at least one tool call
 */
export async function runTurn(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  input: TurnInput,
): Promise<{ sawToolCall: boolean }> {
  try {
    const result = await retry({
      abort: ctx.abort,
      maxRetries: ctx.policy.retry.maxRetries,
      shouldRetry(error: unknown) {
        return classifyRetry(error).retryable && recorder.retries < ctx.policy.retry.maxRetries
      },
      getDelay: (attempt) => retryDelay(attempt, ctx.policy.retry),
      onRetry(error: unknown, attempt: number) {
        const info = classifyRetry(error)
        recorder.recordRetry({
          attempt,
          delayMs: retryDelay(attempt, ctx.policy.retry),
          category: info.category,
          reason: info.reason,
          error: error instanceof Error ? error.message : String(error),
        })
      },
      run: () => runStreamOnce(ctx, stack, recorder, input),
    })

    return { sawToolCall: result.kind === "completed" ? result.sawToolCall : false }
  } catch (error) {
    if (isAbortError(error)) {
      recorder.abort()
      return { sawToolCall: false }
    }
    recorder.fail(toErrorInfo(error, classifyRetry(error).retryable))
    return { sawToolCall: false }
  }
}

async function runStreamOnce(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  input: TurnInput,
): Promise<{ kind: "completed"; sawToolCall: boolean } | { kind: "stop" }> {
  const stream = ctx.model.stream(buildLLMInput(ctx, input))

  recorder.enterPhase("streaming")

  // Collect tool calls as they stream rather than dispatching inline: the turn's
  // full tool set is known only once the stream drains, and running them as one
  // batch is what lets them execute concurrently. Streaming creates no tool parts,
  // so a mid-stream error leaves no half-open call behind.
  const pendingCalls: ToolCall[] = []
  let finishReason: FinishReason | undefined

  for await (const chunk of stream.fullStream) {
    ctx.abort.throwIfAborted()

    if (chunk.type === "tool-call") {
      pendingCalls.push({ toolName: chunk.toolName, toolCallId: chunk.toolCallId, args: chunk.args })
      continue
    }
    if (chunk.type === "error") throw chunk.error
    if (chunk.type === "reasoning") {
      recorder.appendReasoning(chunk.textDelta)
      continue
    }
    if (chunk.type === "text-delta") {
      recorder.appendText(chunk.textDelta)
      continue
    }
    if (chunk.type === "finish") {
      finishReason = chunk.finishReason as FinishReason
    }
  }

  if (pendingCalls.length > 0) {
    const decision = await runToolCalls(ctx, stack, recorder, pendingCalls)
    if (decision.kind === "stop") return { kind: "stop" }
  }

  if (finishReason !== undefined) {
    await finalizeTurn(ctx, stack, recorder, finishReason)
  }

  return { kind: "completed", sawToolCall: pendingCalls.length > 0 }
}

/**
 * Executes a turn's tool calls as one bounded-concurrency batch, then reduces
 * their outcomes into the turn's terminal decision. Every call's tool part is
 * opened up front, in issue order, so parts appear deterministically before any
 * execution starts.
 */
async function runToolCalls(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  calls: ToolCall[],
): Promise<{ kind: "continue" } | { kind: "stop" }> {
  recorder.enterPhase("executing-tool")

  const tracked = calls.map((call) => ({ call, tracker: recorder.trackToolCall(call) }))

  // Run the batch with at most `maxToolCalls` in flight at once, keeping outcomes
  // in issue order regardless of completion order. The bound is a fresh per-turn
  // number, not a shared semaphore, so a parent turn delegating to subagents that
  // themselves fan out tools never contends on one counter and cannot deadlock.
  const outcomes = new Array<ToolCallOutcome>(tracked.length)
  const limit = Math.max(1, ctx.policy.toolConcurrency)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < tracked.length) {
      const index = nextIndex
      nextIndex += 1
      const { call, tracker } = tracked[index]
      outcomes[index] = await executeToolCall(ctx, stack, recorder, call, tracker)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tracked.length) }, () => worker()))

  return reduceTurnTerminal(recorder, outcomes)
}

/**
 * Folds the batch's per-call outcomes into the turn's single terminal transition.
 * Every call has already settled and written its own part; this only decides the
 * turn's fate — the first stop/abort in issue order wins, otherwise the turn
 * continues. The reduction runs after all calls settle so no call is left
 * unresolved (the model replay requires a result for every issued call).
 */
function reduceTurnTerminal(
  recorder: TurnRecorder,
  outcomes: ToolCallOutcome[],
): { kind: "continue" } | { kind: "stop" } {
  for (const outcome of outcomes) {
    if (outcome.status === "abort") {
      recorder.abort()
      return { kind: "stop" }
    }
    if (outcome.status === "stop") {
      recorder.fail(outcome.error)
      recorder.appendNote(outcome.note ?? `\n\n[Stopped: ${outcome.error.message}]`)
      return { kind: "stop" }
    }
  }
  return { kind: "continue" }
}

async function finalizeTurn(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  finishReason: FinishReason,
) {
  const text = ctx.sessions.messageText(ctx.sessionID, ctx.messageID, { includeSynthetic: false })
  const decision = await stack.onTurnFinish(ctx, { finishReason, text })
  if (!decision.ok) {
    recorder.fail(decision.error)
    return
  }
  recorder.finish(finishReason, decision.structured)
}

function buildLLMInput(ctx: TurnContext, input: TurnInput): LLMInput {
  return {
    system: input.system,
    messages: input.messages,
    tools: ctx.tools,
    abort: ctx.abort,
  }
}

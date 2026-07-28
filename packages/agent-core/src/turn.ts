/**
 * runTurn: a single model turn, in two halves. The model call goes through the
 * `wrapModelCall` onion and returns the tool calls it issued; the batch runs
 * afterwards, outside the onion — so a middleware retrying a failed stream can
 * never replay tools, because at that point none have run.
 *
 * Aborts, stream failures, and tool stops are absorbed into the recorder here;
 * a clean model finish is not — its finishReason is returned open so the loop
 * can pass it through afterTurn and apply the terminal exactly once.
 */
import type { TurnContext } from "@agent-core/context"
import type { TurnRecorder } from "@agent-core/recorder"
import type { ToolPartTracker } from "@agent-core/tool-part"
import {
  executeToolCall,
  openToolPart,
  prepareToolCall,
  type PreparedToolCall,
  type ToolCallOutcome,
} from "@agent-core/tool-call"
import type { MiddlewareStack, ModelCallResult, ToolCall } from "@agent-core/hooks"
import type { LLMInput, ModelMessage } from "@agent-core/llm/types"
import { isAbortError, toErrorInfo } from "@agent-core/error"
import { classifyRetry } from "@agent-core/llm/classify"
import type { FinishReason } from "@agent-core/types"

/** The assembled model input for one turn: system fragments + transformed messages. */
export type TurnInput = {
  system: string[]
  messages: ModelMessage[]
}

/**
 * Runs one model turn: the wrapped model call, then its tool batch.
 *
 * @param ctx - the immutable turn context
 * @param stack - the agent's middleware stack, for the per-turn hooks
 * @param recorder - the turn recorder owning accumulation and terminal state
 * @param input - the assembled system fragments and model messages
 * @returns the tool-call flag and, on a clean finish, the still-open finishReason
 */
export async function runTurn(
  ctx: TurnContext,
  stack: MiddlewareStack,
  recorder: TurnRecorder,
  input: TurnInput,
): Promise<{ sawToolCall: boolean; finishReason?: FinishReason }> {
  try {
    const call = await stack.wrapModelCall(ctx, buildLLMInput(ctx, input), (request) =>
      streamModelCall(ctx, recorder, request),
    )

    if (call.toolCalls.length === 0) return { sawToolCall: false, finishReason: call.finishReason }

    const decision = await runToolCalls(ctx, stack, recorder, [...call.toolCalls])
    if (decision.kind === "stop") return { sawToolCall: false }
    return { sawToolCall: true, finishReason: call.finishReason }
  } catch (error) {
    if (isAbortError(error)) {
      recorder.abort()
      return { sawToolCall: false }
    }
    recorder.fail(toErrorInfo(error, classifyRetry(error).retryable))
    return { sawToolCall: false }
  }
}

// The innermost layer of the wrapModelCall onion: one stream, drained into the
// recorder. Tool calls are collected rather than dispatched — the turn's full
// tool set is known only once the stream drains, and running them as one batch
// is what lets them execute concurrently. Streaming creates no tool parts, so a
// mid-stream error leaves no half-open call behind.
async function streamModelCall(
  ctx: TurnContext,
  recorder: TurnRecorder,
  request: LLMInput,
): Promise<ModelCallResult> {
  const stream = ctx.model.stream(request)

  recorder.enterPhase("streaming")

  const toolCalls: ToolCall[] = []
  let finishReason: FinishReason | undefined

  for await (const chunk of stream.fullStream) {
    ctx.abort.throwIfAborted()

    if (chunk.type === "tool-call") {
      toolCalls.push({ toolName: chunk.toolName, toolCallId: chunk.toolCallId, args: chunk.args })
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

  return { finishReason, toolCalls }
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

  // Prepare in issue order, one at a time: this is where the gate runs (a
  // counting guard is only correct in sequence) and where the call's display is
  // derived, so the part opens already saying what the call is for. Preparation
  // is cheap and non-blocking — the work it precedes is what gets concurrency.
  const tracked: { call: ToolCall; tracker: ToolPartTracker; prepared: PreparedToolCall }[] = []
  for (const call of calls) {
    const prepared = await prepareToolCall(ctx, stack, call)
    tracked.push({ call, prepared, tracker: openToolPart(recorder, call, prepared) })
  }

  // Run the batch with at most `toolConcurrency` in flight, keeping outcomes in
  // issue order regardless of completion order. The bound is a fresh per-turn
  // number, so a parent turn delegating to subagents that themselves fan out
  // tools never contends on one counter. Every call is eligible: the dispatcher
  // is blind to tool semantics, and consistency belongs to whoever owns the
  // resource (concurrent file work is made safe by the workspace). A call that
  // depends on another's effect belongs in the next turn, not the same batch.
  const outcomes = new Array<ToolCallOutcome>(tracked.length)
  const limit = Math.max(1, ctx.policy.toolConcurrency)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < tracked.length) {
      const index = nextIndex
      nextIndex += 1
      const { call, tracker, prepared } = tracked[index]
      outcomes[index] = await executeToolCall(ctx, stack, recorder, call, tracker, prepared)
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

function buildLLMInput(ctx: TurnContext, input: TurnInput): LLMInput {
  return {
    system: input.system,
    messages: input.messages,
    tools: ctx.tools,
    abort: ctx.abort,
  }
}

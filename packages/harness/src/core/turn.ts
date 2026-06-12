/**
 * runTurn: a single model turn. Wraps the stream in retry, accumulates output
 * through the TurnRecorder, dispatches tool calls, and finalizes via the
 * onTurnFinish hook. Aborts and stream failures are absorbed into the recorder
 * (its terminal transition) so the loop can decide what to do next.
 */
import type { TurnContext } from "@harness/core/context"
import type { TurnRecorder } from "@harness/core/recorder"
import { dispatchToolCall } from "@harness/core/tool-call"
import type { MiddlewareStack } from "@harness/hooks/stack"
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
  let sawToolCall = false
  const stream = ctx.model.stream(buildLLMInput(ctx, input))

  recorder.enterPhase("streaming")

  for await (const chunk of stream.fullStream) {
    ctx.abort.throwIfAborted()

    if (chunk.type === "tool-call") {
      sawToolCall = true
      const dispatch = await dispatchToolCall(ctx, stack, recorder, chunk)
      if (dispatch.kind === "stop") return { kind: "stop" }
      recorder.enterPhase("streaming")
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
      await finalizeTurn(ctx, stack, recorder, chunk.finishReason as FinishReason)
    }
  }

  return { kind: "completed", sawToolCall }
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

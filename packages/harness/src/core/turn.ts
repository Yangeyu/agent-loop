/**
 * runTurn: a single model turn. Wraps the stream in retry, accumulates output
 * via StreamSink, dispatches tool calls, and finalizes via the onTurnFinish hook.
 */
import type { TurnContext } from "@harness/core/context"
import { dispatchToolCall } from "@harness/core/tool-call"
import { StreamSink } from "@harness/core/stream-sink"
import type { MiddlewareStack } from "@harness/hooks/stack"
import type { LLMInput } from "@harness/llm/types"
import { classifyRetry, isAbortError, retry, retryDelay, toErrorInfo } from "@harness/core/retry"
import type { FinishReason } from "@harness/types"

/**
 * Runs one model turn: streams (with retry) into the StreamSink, dispatching tool
 * calls and finalizing on finish. Aborts and stream failures are absorbed into the
 * sink so the loop can decide what to do next.
 *
 * @param ctx - the turn context (model caller, policy, session ids, abort)
 * @param stack - the agent's middleware stack, for the per-turn hooks
 * @returns whether the turn issued at least one tool call
 */
export async function runTurn(ctx: TurnContext, stack: MiddlewareStack): Promise<{ sawToolCall: boolean }> {
  const sink = new StreamSink(ctx)
  sink.start()

  try {
    const result = await retry({
      abort: ctx.abort,
      maxRetries: ctx.policy.retry.maxRetries,
      shouldRetry(error: unknown) {
        return classifyRetry(error).retryable && ctx.retryCount < ctx.policy.retry.maxRetries
      },
      getDelay: (attempt) => retryDelay(attempt, ctx.policy.retry),
      onRetry(error: unknown, attempt: number) {
        ctx.retryCount += 1
        const info = classifyRetry(error)
        ctx.events.emit({
          type: "retry",
          sessionID: ctx.sessionID,
          agent: ctx.agent.name,
          messageID: ctx.assistant.parentID,
          turnID: ctx.assistant.id,
          attempt,
          delayMs: retryDelay(attempt, ctx.policy.retry),
          category: info.category,
          reason: info.reason,
          error: error instanceof Error ? error.message : String(error),
        })
      },
      run: () => runStreamOnce(ctx, stack, sink),
    })

    return { sawToolCall: result.kind === "completed" ? result.sawToolCall : false }
  } catch (error) {
    if (isAbortError(error)) {
      sink.abort()
      return { sawToolCall: false }
    }
    sink.fail(toErrorInfo(error, classifyRetry(error).retryable))
    return { sawToolCall: false }
  }
}

async function runStreamOnce(
  ctx: TurnContext,
  stack: MiddlewareStack,
  sink: StreamSink,
): Promise<{ kind: "completed"; sawToolCall: boolean } | { kind: "stop" }> {
  let sawToolCall = false
  const stream = ctx.model.stream(buildLLMInput(ctx))

  sink.enterPhase("streaming")

  for await (const chunk of stream.fullStream) {
    ctx.abort.throwIfAborted()

    if (chunk.type === "tool-call") {
      sawToolCall = true
      const dispatch = await dispatchToolCall(ctx, stack, sink, chunk)
      if (dispatch.kind === "stop") return { kind: "stop" }
      sink.enterPhase("streaming")
      continue
    }

    if (chunk.type === "error") throw chunk.error
    if (chunk.type === "reasoning") {
      sink.appendReasoning(chunk.textDelta)
      continue
    }
    if (chunk.type === "text-delta") {
      sink.appendText(chunk.textDelta)
      continue
    }
    if (chunk.type === "finish") {
      await finalizeTurn(ctx, stack, sink, chunk.finishReason as FinishReason)
    }
  }

  return { kind: "completed", sawToolCall }
}

async function finalizeTurn(ctx: TurnContext, stack: MiddlewareStack, sink: StreamSink, finishReason: FinishReason) {
  const text = ctx.session_store.getMessageText(ctx.sessionID, ctx.assistant.id, { includeSynthetic: false })
  const decision = await stack.onTurnFinish(ctx, { finishReason, text })
  if (!decision.ok) {
    sink.fail(decision.error)
    return
  }
  sink.finish(finishReason, decision.structured)
}

function buildLLMInput(ctx: TurnContext): LLMInput {
  return {
    system: ctx.system,
    messages: ctx.messages,
    tools: ctx.tools,
    abort: ctx.abort,
  }
}

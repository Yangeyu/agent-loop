import { LLM, type LLMChunk } from "@harness/llm/index"
import {
  createProcessorContext,
  resolveProcessorResult,
  type ProcessorAction,
  type ProcessorContext,
  type ProcessorInput,
} from "@harness/session/processor-context"
import {
  classifyRetry,
  isAbortError,
  retryDelay,
  retry,
  toErrorInfo,
} from "@harness/session/retry"
import { ToolCallExecutor } from "@harness/session/tool-executor"
import { TurnLifecycle } from "@harness/session/turn-lifecycle"
import type { ProcessorResult } from "@harness/types"

type NonToolChunk = Exclude<LLMChunk, { type: "tool-call" | "error" }>

export namespace SessionProcessor {
  export async function process(input: ProcessorInput): Promise<ProcessorResult> {
    const context = createProcessorContext(input)
    const lifecycle = new TurnLifecycle(context)
    const toolExecutor = new ToolCallExecutor(context, lifecycle)

    lifecycle.start()

    const attemptResult = await runProcessorWithRetry({
      input,
      context,
      lifecycle,
      toolExecutor,
    })

    if (attemptResult.kind === "stop") return "stop"
    return resolveProcessorResult(context, { sawToolCall: attemptResult.sawToolCall })
  }
}

async function runProcessorWithRetry(input: {
  input: ProcessorInput
  context: ProcessorContext
  lifecycle: TurnLifecycle
  toolExecutor: ToolCallExecutor
}): Promise<
  | { kind: "completed"; sawToolCall: boolean }
  | { kind: "stop" }
> {
  try {
    const runResult = await retry({
      abort: input.input.abort,
      maxRetries: input.input.policy.retry.maxRetries,
      shouldRetry(error: unknown) {
        return classifyRetry(error).retryable && input.context.retryCount < input.input.policy.retry.maxRetries
      },
      getDelay: (attempt) => retryDelay(attempt, input.input.policy.retry),
      onRetry(error: unknown, attempt: number) {
        input.context.retryCount += 1
        const retryInfo = classifyRetry(error)
        const delayMs = retryDelay(attempt, input.input.policy.retry)

        input.context.events.emit({
          type: "retry",
          sessionID: input.context.session.id,
          agent: input.context.agent.name,
          messageID: input.context.assistant.parentID,
          turnID: input.context.assistant.id,
          attempt,
          delayMs,
          category: retryInfo.category,
          reason: retryInfo.reason,
          error: error instanceof Error ? error.message : String(error),
        })
      },
      run: () =>
        runStreamOnce({
          input: input.input,
          lifecycle: input.lifecycle,
          toolExecutor: input.toolExecutor,
        }),
    })

    if (runResult.kind === "stop") return { kind: "stop" }
    return { kind: "completed", sawToolCall: runResult.sawToolCall }
  } catch (error) {
    if (isAbortError(error)) {
      input.lifecycle.abort()
      return { kind: "stop" }
    }

    const retryInfo = classifyRetry(error)
    input.lifecycle.fail(toErrorInfo(error, retryInfo.retryable))
    return { kind: "stop" }
  }
}

async function runStreamOnce(input: {
  input: ProcessorInput
  lifecycle: TurnLifecycle
  toolExecutor: ToolCallExecutor
}): Promise<
  | { kind: "completed"; sawToolCall: boolean }
  | { kind: "stop" }
> {
  let sawToolCall = false
  const result = LLM.stream(input.input)

  input.lifecycle.enterPhase("streaming")

  for await (const chunk of result.fullStream) {
    input.input.abort.throwIfAborted()

    if (chunk.type === "tool-call") {
      sawToolCall = true
      const toolResult = await input.toolExecutor.execute(chunk)
      if (toolResult.kind === "stop") return { kind: "stop" }
      input.lifecycle.enterPhase("streaming")
      continue
    }

    if (chunk.type === "error") {
      throw chunk.error
    }

    applyActions(input.lifecycle, interpretChunk(chunk))
  }

  return { kind: "completed", sawToolCall }
}

function interpretChunk(chunk: NonToolChunk): ProcessorAction[] {
  switch (chunk.type) {
    case "reasoning":
      return [{ kind: "append-reasoning", textDelta: chunk.textDelta }]
    case "text-delta":
      return [{ kind: "append-text", textDelta: chunk.textDelta }]
    case "finish":
      return [{ kind: "finish", finishReason: chunk.finishReason as ProcessorContext["assistant"]["finish"] }]
  }
}

function applyActions(lifecycle: TurnLifecycle, actions: ProcessorAction[]): void {
  for (const action of actions) {
    if (action.kind === "append-reasoning") {
      lifecycle.appendReasoning(action.textDelta)
      continue
    }

    if (action.kind === "append-text") {
      lifecycle.appendText(action.textDelta)
      continue
    }

    lifecycle.finish(action.finishReason)
  }
}

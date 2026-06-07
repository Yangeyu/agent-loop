// Model registry and runtime selection. Currently qwen-only; the provider is
// injected onto the runtime (runtime/context.ts) so tests can swap it.
import { qwenStream } from "@harness/llm/providers/qwen"
import type { LLMInput, LLMStreamResult, ModelRuntime, ModelSpec } from "@harness/llm/types"

const qwenSpec: ModelSpec = {
  id: "qwen",
  provider: "qwen-compatible",
  capabilities: {
    tools: true,
    reasoning: true,
    structuredOutput: true,
    streaming: true,
  },
  defaults: {
    modelID: "qwen3.5-plus",
    temperature: 0.2,
  },
}

const qwenRuntime: ModelRuntime = {
  spec: qwenSpec,
  streamText: qwenStream,
}

export function streamText(input: LLMInput): LLMStreamResult {
  return qwenRuntime.streamText(input)
}

export function resolveModelSpec() {
  return qwenRuntime.spec
}

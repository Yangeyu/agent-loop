// Model registry and runtime selection live here.
import { fakeStream } from "@harness/llm/providers/fake"
import { qwenStream } from "@harness/llm/providers/qwen"
import type { LLMInput, LLMStreamResult, ModelRuntime, ModelSpec } from "@harness/llm/types"

const modelSpecs: Record<"fake" | "qwen", ModelSpec> = {
  fake: {
    id: "fake",
    provider: "local",
    capabilities: {
      tools: true,
      reasoning: true,
      structuredOutput: true,
      streaming: true,
    },
    defaults: {
      modelID: "fake",
      temperature: 0,
    },
  },
  qwen: {
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
  },
}

const runtimes: Record<keyof typeof modelSpecs, ModelRuntime> = {
  fake: {
    spec: modelSpecs.fake,
    streamText: fakeStream,
  },
  qwen: {
    spec: modelSpecs.qwen,
    streamText: qwenStream,
  },
}

export function streamText(input: LLMInput): LLMStreamResult {
  return resolveModelRuntime().streamText(input)
}

export function resolveModelSpec() {
  return resolveModelRuntime().spec
}

function resolveModelRuntime(): ModelRuntime {
  const mode = process.env.LLM_MODE ?? (hasQwenKey() ? "qwen" : "fake")
  return mode === "fake" ? runtimes.fake : runtimes.qwen
}

function hasQwenKey() {
  return Boolean(process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY)
}

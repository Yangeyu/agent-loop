/** Public LLM entrypoint: the Model abstraction and provider model factories. */
export type {
  LLMChunk,
  LLMInput,
  LLMStreamResult,
  Model,
  ModelCapabilities,
  ModelMessage,
  ProviderModelSpec,
} from "@harness/llm/types"
export { createDashScopeModel } from "@harness/llm/providers/dashscope"
export type { DashScopeConfig } from "@harness/llm/providers/dashscope"
export { createOpenAICompatModel } from "@harness/llm/providers/openai-compat"
export type { OpenAICompatModelConfig } from "@harness/llm/providers/openai-compat"

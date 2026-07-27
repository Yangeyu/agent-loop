/** Public LLM entrypoint: the Model abstraction and provider model factories. */
export type {
  LLMChunk,
  LLMInput,
  LLMStreamResult,
  Model,
  ModelCapabilities,
  ModelContentBlock,
  ModelMessage,
  ProviderModelSpec,
} from "@agent-core/llm/types"
export { createDashScopeModel } from "@agent-core/llm/providers/dashscope"
export type { DashScopeConfig } from "@agent-core/llm/providers/dashscope"
export { createOpenAICompatModel } from "@agent-core/llm/providers/openai-compat"
export type { OpenAICompatModelConfig } from "@agent-core/llm/providers/openai-compat"
export { createFakeModel } from "@agent-core/llm/fake"
export type { FakeModelOptions } from "@agent-core/llm/fake"
export { resolveImageSource } from "@agent-core/llm/image"

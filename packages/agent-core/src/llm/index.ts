/** The model port: the Model abstraction, its stream protocol, and the shipped fake. */
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
export { createFakeModel } from "@agent-core/llm/fake"
export type { FakeModelOptions } from "@agent-core/llm/fake"

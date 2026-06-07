// Per-agent model binding: turns a declarative ModelSelector into a ModelCaller
// using the runtime's injected provider. LLM creation lives at the agent layer;
// the core engine only ever consumes a ModelCaller.
import type { LLMInput, LLMStreamResult } from "@harness/llm/types"
import type { ProviderModel } from "@harness/types"

export type ModelSelector = {
  providerID: string
  modelID: string
  temperature?: number
}

// The low-level streaming provider (e.g. qwen). Injected on the runtime so tests
// can supply a stub without a registered provider.
export type ModelProvider = (input: LLMInput) => LLMStreamResult

export type ModelCaller = {
  selector: ModelSelector
  providerModel: ProviderModel
  stream(input: LLMInput): LLMStreamResult
}

export function createModelCaller(selector: ModelSelector, provider: ModelProvider): ModelCaller {
  return {
    selector,
    providerModel: { providerID: selector.providerID, modelID: selector.modelID },
    stream: (input) => provider(input),
  }
}

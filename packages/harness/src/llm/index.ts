/** Public LLM entrypoint used by the session loop. */
import { streamText } from "@harness/llm/models"
import type { LLMInput, LLMStreamResult } from "@harness/llm/types"

export type { LLMChunk, LLMInput, LLMStreamResult, ModelMessage } from "@harness/llm/types"
export { streamText } from "@harness/llm/models"

/** Namespaced façade over the model entrypoint, injected as the runtime's LLM. */
export namespace LLM {
  /**
   * Streams a single model response for the assembled input.
   *
   * @param input - the assembled LLM input (selects provider + model)
   * @returns the provider's streaming result
   */
  export function stream(input: LLMInput): LLMStreamResult {
    return streamText(input)
  }
}

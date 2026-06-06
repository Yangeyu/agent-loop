// Public LLM entrypoint used by the session loop.
import { streamText } from "@harness/llm/models"
import type { LLMInput, LLMStreamResult } from "@harness/llm/types"

export type { LLMChunk, LLMInput, LLMStreamResult, ModelMessage } from "@harness/llm/types"
export { streamText } from "@harness/llm/models"

export namespace LLM {
  export function stream(input: LLMInput): LLMStreamResult {
    return streamText(input)
  }
}

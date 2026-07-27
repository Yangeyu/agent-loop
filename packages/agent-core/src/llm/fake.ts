// A scriptable Model stub: replays a fixed chunk script per stream call and
// (optionally) records each input, so a test can drive the loop deterministically
// without a network provider. Ships with the package because the port is public
// — anything building on this loop needs a Model it can script.
import type { LLMChunk, LLMInput, Model, ProviderModelSpec } from "@agent-core/llm/types"

export type FakeModelOptions = {
  // The chunks each stream() call replays (defaults to a single empty finish).
  chunks?: LLMChunk[]
  // Overrides for the bound model spec (id / capabilities / contextWindow).
  spec?: { id?: string; contextWindow?: number; capabilities?: Partial<ProviderModelSpec["capabilities"]> }
  // Called with every stream() input — use to record calls / assert routing.
  onStream?: (input: LLMInput) => void
}

const DEFAULT_SCRIPT: LLMChunk[] = [{ type: "finish", finishReason: "stop" }]

export function createFakeModel(options: FakeModelOptions = {}): Model {
  const spec: ProviderModelSpec = {
    id: options.spec?.id ?? "fake-model",
    capabilities: {
      tools: true,
      reasoning: true,
      structuredOutput: true,
      streaming: true,
      vision: true,
      parallelToolCalls: true,
      ...options.spec?.capabilities,
    },
    contextWindow: options.spec?.contextWindow ?? 100_000,
  }
  const chunks = options.chunks ?? DEFAULT_SCRIPT
  return {
    providerID: "fake",
    spec,
    stream(input) {
      options.onStream?.(input)
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
  }
}

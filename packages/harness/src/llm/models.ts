/**
 * Provider registry + the unified model entrypoint. Each provider is created by
 * its own module (e.g. providers/dashscope.ts) and registered here; adding a
 * vendor = adding its factory to this registry. streamText routes each request
 * to a provider by input.user.model.providerID; resolveModelSpec looks up a
 * model's capabilities/context window for the middleware that gate on them
 * (compaction, view-image).
 */
import { dashScope } from "@harness/llm/providers/dashscope"
import type { LLMInput, LLMStreamResult, Provider, ProviderModelSpec } from "@harness/llm/types"

const providers: Provider[] = [dashScope()]

const providerRegistry: Record<string, Provider> = Object.fromEntries(providers.map((provider) => [provider.id, provider]))

const DEFAULT_PROVIDER_ID = providers[0].id

/**
 * The unified model entrypoint: routes a request to its provider by
 * `input.user.model.providerID` and streams a single Chat Completions response.
 *
 * @param input - the assembled LLM input (its user.model selects provider + model)
 * @returns the provider's streaming result
 */
export function streamText(input: LLMInput): LLMStreamResult {
  return resolveProvider(input.user.model.providerID).stream(input)
}

/**
 * A resolved model spec plus its provider id, so display surfaces can show both
 * (the gating middleware only read capabilities/contextWindow).
 */
export type ResolvedModelSpec = ProviderModelSpec & { providerID: string }

/**
 * Resolves a model's spec (capabilities + context window) for callers that gate on
 * them (compaction, view-image). Defaults to the default provider's default model
 * when no selector is given — the lead agent's model — so the gating middleware can
 * stay selector-free.
 *
 * @param selector - optional provider/model ids; omitted fields fall back to defaults
 * @returns the resolved model spec, tagged with its provider id
 * @throws if the selector names a provider that is not registered
 */
export function resolveModelSpec(selector?: { providerID?: string; modelID?: string }): ResolvedModelSpec {
  const provider = resolveProvider(selector?.providerID)
  const wanted = selector?.modelID || provider.defaultModelID
  const model =
    provider.models.find((entry) => entry.id === wanted) ??
    provider.models.find((entry) => entry.id === provider.defaultModelID) ??
    provider.models[0]
  return { ...model, providerID: provider.id }
}

function resolveProvider(providerID?: string): Provider {
  const provider = providerRegistry[providerID || DEFAULT_PROVIDER_ID]
  if (!provider) throw new Error(`Unknown model provider "${providerID}". Registered: ${Object.keys(providerRegistry).join(", ")}.`)
  return provider
}

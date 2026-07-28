/**
 * DashScope (Alibaba Cloud Model Studio) provider — its own createModel factory.
 * It serves the qwen model family over the OpenAI-compatible endpoint, so it
 * builds on the shared compat base (createOpenAICompatModel) rather than carrying
 * transport code; it owns its model catalog (capabilities + context window),
 * resolves the connection (endpoint + key, with env fallbacks), and supplies the
 * two DashScope-specific quirks as hooks:
 *   - enable_thinking: a request-body knob (not in the OpenAI schema) that turns
 *     on qwen's chain-of-thought; gated on the model's reasoning capability.
 *   - reasoning_content: qwen streams CoT in this non-standard delta field.
 */
import { z } from "zod"
import type { Model, ProviderModelSpec } from "@agent-core/llm/types"
import { createOpenAICompatModel } from "@agent-core/llm/providers/openai-compat"

// The streaming delta shape we read DashScope's non-standard reasoning field off
// of (not part of the OpenAI SDK types, hence the local declaration).
type DashScopeDelta = { reasoning_content?: string | null }

const PROVIDER_ID = "dashscope"
const DEFAULT_MODEL_ID = "qwen3.7-plus"

// The provider owns its own connection config (endpoint + key) — vendor wiring
// does not belong in the engine's behavioral config. Defaults are declared here
// via the schema; env (DASHSCOPE_BASE_URL / DASHSCOPE_API_KEY) overrides them.
const ConnectionSchema = z.object({
  baseURL: z.string().default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  apiKey: z.string().default(""),
})

const resolveConnection = () =>
  ConnectionSchema.parse({ baseURL: process.env.DASHSCOPE_BASE_URL, apiKey: process.env.DASHSCOPE_API_KEY })

// The qwen models this provider serves, keyed by id. Capabilities + context
// window are per-model (qwen3.7-plus is multimodal; qwen3.6-flash is a cheaper
// text model). createDashScopeModel resolves a spec from here by modelID.
const MODELS: Record<string, ProviderModelSpec> = {
  "qwen3.7-plus": {
    id: "qwen3.7-plus",
    capabilities: { tools: true, reasoning: true, structuredOutput: true, streaming: true, vision: true, parallelToolCalls: true },
    contextWindow: 262144,
  },
  "qwen3.6-flash": {
    id: "qwen3.6-flash",
    capabilities: { tools: true, reasoning: true, structuredOutput: true, streaming: true, vision: false, parallelToolCalls: true },
    contextWindow: 131072,
  },
}

/** Config for a DashScope model instance: which model + optional connection overrides. */
export type DashScopeConfig = {
  /** The qwen model to bind; defaults to qwen3.7-plus. An unknown id throws. */
  modelID?: string
  /** Connection override; defaults through DASHSCOPE_BASE_URL. */
  baseURL?: string
  /** Connection override; defaults through DASHSCOPE_API_KEY. */
  apiKey?: string
  temperature?: number
}

/**
 * Creates a bound DashScope (qwen) Model. Pass the result straight to an agent
 * (defineAgent({ model })) or use it for a one-shot call — it is already bound
 * to its model + connection. The endpoint/key default through the provider's
 * ConnectionSchema, so a caller that does not override them needs no
 * connection args.
 *
 * @param config - the target model id and optional connection/temperature overrides
 * @returns a Model serving the selected qwen model
 */
export function createDashScopeModel(config: DashScopeConfig = {}): Model {
  const modelID = config.modelID ?? DEFAULT_MODEL_ID
  const spec = MODELS[modelID]
  if (!spec) {
    throw new Error(
      `Unknown DashScope model "${modelID}". Known models: ${Object.keys(MODELS).join(", ")}.`,
    )
  }
  const connection = resolveConnection()
  return createOpenAICompatModel({
    providerID: PROVIDER_ID,
    baseURL: config.baseURL ?? connection.baseURL,
    apiKey: config.apiKey ?? connection.apiKey,
    model: spec,
    temperature: config.temperature,
    extraBody: (model) => ({ enable_thinking: model.capabilities.reasoning }),
    readReasoning: (delta) => (delta as DashScopeDelta).reasoning_content ?? undefined,
  })
}

/**
 * DashScope (Alibaba Cloud Model Studio) provider — its own implementation. It
 * serves the qwen model family over the OpenAI-compatible endpoint, so it builds
 * on the shared compat factory rather than carrying transport code; it owns the
 * creation and supplies its endpoint/key/models plus the two DashScope-specific
 * quirks as hooks:
 *   - enable_thinking: a request-body knob (not in the OpenAI schema) that turns
 *     on qwen's chain-of-thought; gated on the model's reasoning capability.
 *   - reasoning_content: qwen streams CoT in this non-standard delta field.
 */
import type { Provider } from "@harness/llm/types"
import { createOpenAICompatProvider } from "@harness/llm/providers/openai-compat"

// The streaming delta shape we read DashScope's non-standard reasoning field off
// of (not part of the OpenAI SDK types, hence the local declaration).
type DashScopeDelta = { reasoning_content?: string | null }

/**
 * Creates the DashScope provider. Register the result in the provider registry
 * (llm/models.ts) to route `providerID: "dashscope"` requests here.
 *
 * @returns the DashScope Provider, serving the qwen model family
 */
export function dashScope(): Provider {
  return createOpenAICompatProvider({
    id: "dashscope",
    baseURL: process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    defaultModelID: "qwen3.7-plus",
    models: [
      {
        id: "qwen3.7-plus",
        capabilities: { tools: true, reasoning: true, structuredOutput: true, streaming: true, vision: true },
        contextWindow: 262144,
      },
      {
        id: "qwen3.6-flash",
        capabilities: { tools: true, reasoning: true, structuredOutput: true, streaming: true, vision: false },
        contextWindow: 131072,
      },
    ],
    extraBody: (model) => ({ enable_thinking: model.capabilities.reasoning }),
    readReasoning: (delta) => (delta as DashScopeDelta).reasoning_content ?? undefined,
  })
}

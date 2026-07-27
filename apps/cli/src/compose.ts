// Composition root for the CLI surface. This is the ONE place providers are
// bound: models are built here and injected into the agent/tool factories; the
// runtime receives flat lists — composition is code.
import {
  createCoreAgents,
  createCoreTools,
  createDashScopeModel,
  createRuntime,
  getConfig,
  loadSkillsFromDir,
  type Config,
  type RuntimeContext,
} from "@harness"

const CHAT_MODEL_ID = "qwen3.7-plus"
const SUMMARIZER_MODEL_ID = "qwen3.6-flash"

function assembleApp(config: Config) {
  const chat = createDashScopeModel({ modelID: CHAT_MODEL_ID })
  const summarizer = createDashScopeModel({ modelID: SUMMARIZER_MODEL_ID })

  return {
    agents: createCoreAgents({
      model: chat,
      summarizer,
      retry: {
        maxRetries: config.model_max_retries,
        baseDelayMs: config.model_retry_base_delay_ms,
        maxDelayMs: config.model_retry_max_delay_ms,
      },
    }),
    // The chat model is multimodal; view_image reuses it as the vision model.
    tools: createCoreTools({ visionModel: chat }),
    // Skills come from the workspace's own skills_dir, discovered from where the
    // app runs — adding a skill never means touching this file.
    skills: loadSkillsFromDir(config.skills_dir, { optional: true }),
  }
}

export function createAppRuntime(options?: { config?: Config }): RuntimeContext {
  const config = options?.config ?? getConfig()
  return createRuntime({ config, ...assembleApp(config) })
}


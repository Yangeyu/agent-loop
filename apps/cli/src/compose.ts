// Composition root for the CLI surface. This is the ONE place providers are
// bound: models are built here and injected into the agent/tool factories; the
// runtime receives flat lists — composition is code.
import {
  createCoreAgents,
  createCoreTools,
  createDashScopeModel,
  createRuntime,
  getConfig,
  loadConfigFromEnv,
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
    agents: createCoreAgents({ model: chat, summarizer }),
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

export function createAppTestRuntime(options?: { config?: Partial<Config> }): RuntimeContext {
  const config = {
    ...loadConfigFromEnv({ ...process.env, SESSION_STORE: "memory" }),
    ...options?.config,
  }
  return createRuntime({ config, ...assembleApp(config) })
}

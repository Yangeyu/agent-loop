// Composition root for the backend surface (also consumed by the CLI). This is
// the ONE place providers are bound: models are built here and injected into the
// agent/tool factories; the runtime receives flat lists — composition is code.
import {
  createCoreAgents,
  createCoreTools,
  createDashScopeModel,
  createRuntime,
  createTestRuntime,
  type Config,
  type RuntimeContext,
} from "@harness"
import { boardSkills, boardTools, createBoardAgents } from "@backend/board"

const CHAT_MODEL_ID = "qwen3.7-plus"
const SUMMARIZER_MODEL_ID = "qwen3.6-flash"

function assembleApp() {
  const chat = createDashScopeModel({ modelID: CHAT_MODEL_ID })
  const summarizer = createDashScopeModel({ modelID: SUMMARIZER_MODEL_ID })

  return {
    agents: [...createCoreAgents({ model: chat, summarizer }), ...createBoardAgents({ model: chat })],
    // The chat model is multimodal; view_image reuses it as the vision model.
    tools: [...createCoreTools({ visionModel: chat }), ...boardTools],
    skills: boardSkills,
  }
}

export function createAppRuntime(options?: { config?: Config }): RuntimeContext {
  return createRuntime({ config: options?.config, ...assembleApp() })
}

export function createAppTestRuntime(options?: { config?: Partial<Config> }): RuntimeContext {
  return createTestRuntime({ config: options?.config, ...assembleApp() })
}

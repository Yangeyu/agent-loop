/**
 * Composition root for the CLI surface. This is the ONE place providers are
 * bound: the models are built here, and everything downstream of them is the
 * harness's standard assembly.
 */
import { createCoreRuntime, getConfig, loadSkillsFromDir, type Config, type RuntimeContext } from "@harness"
import { createDashScopeModel } from "@agent-core"

const CHAT_MODEL_ID = "qwen3.7-plus"
const SUMMARIZER_MODEL_ID = "qwen3.6-flash"

export function createAppRuntime(options?: { config?: Config }): RuntimeContext {
  const config = options?.config ?? getConfig()
  return createCoreRuntime({
    config,
    chat: createDashScopeModel({ modelID: CHAT_MODEL_ID }),
    summarizer: createDashScopeModel({ modelID: SUMMARIZER_MODEL_ID }),
    // Skills come from the workspace's own skills_dir, discovered from where the
    // app runs — adding a skill never means touching this file.
    skills: loadSkillsFromDir(config.skills_dir, { optional: true }),
  })
}

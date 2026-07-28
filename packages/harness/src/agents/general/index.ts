import { GENERAL_INSTRUCTIONS } from "@harness/agents/general/prompt"
import { baseMiddleware } from "@harness/agents/shared/base-middleware"
import { createHarnessAgent, type HarnessAgent } from "@harness/registry"
import type { EngineDeps, Model } from "@agent-core"
import type { SkillRegistry } from "@harness/skills/registry"
import type { RetryOptions } from "@harness/middleware"
import { createAvailableSkills } from "@harness/tools/skill"
import type { ToolDefinition } from "@agent-core"

/**
 * Builds the general-purpose delegated subagent.
 *
 * @param deps.model - the chat model this agent runs on
 * @param deps.tools - the tools it may call (no delegation of its own)
 * @param deps.skills - the skill catalogue it announces
 * @param deps.retry - model-call retry bounds
 * @param deps.engine - the runtime's engine deps (shared store and bus)
 */
export function createGeneralAgent(deps: {
  model: Model
  tools: ToolDefinition[]
  skills: SkillRegistry
  retry?: RetryOptions
  engine: EngineDeps
}): HarnessAgent {
  return createHarnessAgent({
    name: "general",
    description: "General-purpose subagent for multistep delegated work.",
    mode: "subagent",
    deps: deps.engine,
    model: deps.model,
    instructions: GENERAL_INSTRUCTIONS,
    tools: deps.tools,
    steps: 4,
    middleware: baseMiddleware([createAvailableSkills({ skills: deps.skills })], deps.retry),
  })
}

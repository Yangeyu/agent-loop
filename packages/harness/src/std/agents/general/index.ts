import { GENERAL_INSTRUCTIONS } from "@harness/std/agents/general/prompt"
import { baseMiddleware } from "@harness/std/agents/shared/base-middleware"
import { defineHarnessAgent, type HarnessAgent } from "@harness/agent/registry"
import type { Model } from "@harness/llm/types"
import type { SkillRegistry } from "@harness/skill/registry"
import type { RetryOptions } from "@harness/std/middleware"
import { createAvailableSkills } from "@harness/std/tools/skill"
import type { ToolDefinition } from "@harness/types"

/**
 * Builds the general-purpose delegated subagent.
 *
 * @param deps.model - the chat model this agent runs on
 * @param deps.tools - the tools it may call (no delegation of its own)
 * @param deps.skills - the skill catalogue it announces
 * @param deps.retry - model-call retry bounds
 */
export function createGeneralAgent(deps: {
  model: Model
  tools: ToolDefinition[]
  skills: SkillRegistry
  retry?: RetryOptions
}): HarnessAgent {
  return defineHarnessAgent({
    name: "general",
    description: "General-purpose subagent for multistep delegated work.",
    mode: "subagent",
    model: deps.model,
    instructions: GENERAL_INSTRUCTIONS,
    tools: deps.tools,
    steps: 4,
    middleware: baseMiddleware([createAvailableSkills({ skills: deps.skills })], deps.retry),
  })
}

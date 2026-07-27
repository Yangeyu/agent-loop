import { GENERAL_INSTRUCTIONS } from "@harness/std/agents/general/prompt"
import { baseMiddleware } from "@harness/std/agents/shared/base-middleware"
import { defineAgent, type AgentDefinition } from "@harness/agent/blueprint"
import type { Model } from "@harness/llm/types"
import { availableSkills } from "@harness/std/tools/skill"
import type { RetryOptions } from "@harness/std/middleware"

/**
 * Builds the general-purpose delegated subagent. The atom declares what it
 * needs (a Model); the composition root decides which provider satisfies it.
 *
 * @param deps.model - the chat model this agent runs on
 * @param deps.retry - model-call retry bounds
 */
export function createGeneralAgent(deps: { model: Model; retry?: RetryOptions }): AgentDefinition {
  return defineAgent({
    name: "general",
    description: "General-purpose subagent for multistep delegated work.",
    mode: "subagent",
    model: deps.model,
    instructions: GENERAL_INSTRUCTIONS,
    tools: {
      read: true,
      write: true,
      edit: true,
      grep: true,
      tavily: true,
      present_files: true,
      bash: true,
      skill: true,
    },
    steps: 4,
    middleware: baseMiddleware([availableSkills], deps.retry),
  })
}

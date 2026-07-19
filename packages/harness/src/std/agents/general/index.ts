import { deliverableGuidance } from "@harness/std/agents/general/middleware"
import { GENERAL_INSTRUCTIONS } from "@harness/std/agents/general/prompt"
import { baseMiddleware } from "@harness/std/agents/shared/base-middleware"
import { BASE_AGENT_INSTRUCTIONS } from "@harness/std/agents/shared/base-prompt"
import { defineAgent, type AgentDefinition } from "@harness/agent/blueprint"
import type { Model } from "@harness/llm/types"

/**
 * Builds the general-purpose delegated subagent. The atom declares what it
 * needs (a Model); the composition root decides which provider satisfies it.
 *
 * @param deps.model - the chat model this agent runs on
 */
export function createGeneralAgent(deps: { model: Model }): AgentDefinition {
  return defineAgent({
    name: "general",
    description: "General-purpose subagent for multistep delegated work.",
    mode: "subagent",
    model: deps.model,
    instructions: [...BASE_AGENT_INSTRUCTIONS, ...GENERAL_INSTRUCTIONS],
    tools: {
      read: true,
      grep: true,
      tavily: true,
      present_files: true,
      bash: true,
      skill: true,
    },
    steps: 4,
    middleware: [...baseMiddleware(), deliverableGuidance],
  })
}

import { createGeneralAgent } from "@harness/std/agents/general"
import { createLeadAgent } from "@harness/std/agents/lead"
import type { AgentDefinition } from "@harness/agent/blueprint"
import type { Model } from "@harness/llm/types"

/**
 * Builds the core agent set: lead (primary orchestrator, execution entry) and
 * general (delegated subagent).
 *
 * @param deps.model - the chat model both agents run on
 * @param deps.summarizer - the compaction summarizer for the lead agent
 */
export function createCoreAgents(deps: { model: Model; summarizer: Model }): AgentDefinition[] {
  return [createLeadAgent(deps), createGeneralAgent({ model: deps.model })]
}

export { createGeneralAgent, createLeadAgent }

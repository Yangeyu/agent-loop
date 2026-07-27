import { createGeneralAgent } from "@harness/std/agents/general"
import { createLeadAgent } from "@harness/std/agents/lead"
import type { AgentDefinition } from "@harness/agent/blueprint"
import type { Model } from "@harness/llm/types"
import type { RetryOptions } from "@harness/std/middleware"

/**
 * Builds the core agent set: lead (primary orchestrator, execution entry) and
 * general (delegated subagent).
 *
 * @param deps.model - the chat model both agents run on
 * @param deps.summarizer - the compaction summarizer for the lead agent
 * @param deps.retry - model-call retry bounds, shared by both agents
 */
export function createCoreAgents(deps: { model: Model; summarizer: Model; retry?: RetryOptions }): AgentDefinition[] {
  return [createLeadAgent(deps), createGeneralAgent({ model: deps.model, retry: deps.retry })]
}

export { createGeneralAgent, createLeadAgent }

import { createGeneralAgent } from "@harness/agents/general"
import { createLeadAgent } from "@harness/agents/lead"
import type { AgentRegistration, AgentRegistry } from "@harness/registry"
import type { EngineDeps, Model } from "@agent-core"
import type { SkillRegistry } from "@harness/skills/registry"
import type { RetryOptions } from "@harness/middleware"
import type { ToolDefinition } from "@agent-core"

// Withheld from the delegated subagent: the two delegation tools, because a
// subagent that can delegate turns a two-level tree into an unbounded one, and
// view_image, which the lead owns as the vision entry point.
const LEAD_ONLY = new Set(["task", "task_resume", "view_image"])

/**
 * Builds the core agent set with its roles: lead (primary orchestrator,
 * execution entry) and general (delegated subagent). The roles are
 * composition data — they say where each agent sits in this set, and land in
 * the registry at registration.
 *
 * @param deps.model - the chat model both agents run on
 * @param deps.summarizer - the compaction summarizer for the lead agent
 * @param deps.tools - the full core tool set; each agent takes its own slice
 * @param deps.skills - the skill catalogue both agents announce
 * @param deps.agents - the registry the lead announces its delegates from
 * @param deps.retry - model-call retry bounds, shared by both agents
 * @param deps.engine - the runtime's engine deps, shared by both agents
 */
export function createCoreAgents(deps: {
  model: Model
  summarizer: Model
  tools: ToolDefinition[]
  skills: SkillRegistry
  agents: AgentRegistry
  retry?: RetryOptions
  engine: EngineDeps
}): AgentRegistration[] {
  return [
    { agent: createLeadAgent(deps), mode: "primary" },
    {
      agent: createGeneralAgent({
        model: deps.model,
        tools: deps.tools.filter((tool) => !LEAD_ONLY.has(tool.id)),
        skills: deps.skills,
        retry: deps.retry,
        engine: deps.engine,
      }),
      mode: "subagent",
    },
  ]
}

export { createGeneralAgent, createLeadAgent }

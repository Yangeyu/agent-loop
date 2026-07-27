import { LEAD_INSTRUCTIONS } from "@harness/std/agents/lead/prompt"
import { baseMiddleware } from "@harness/std/agents/shared/base-middleware"
import { defineHarnessAgent, type AgentRegistry, type HarnessAgent } from "@harness/agent/registry"
import type { Model } from "@harness/llm/types"
import type { SkillRegistry } from "@harness/skill/registry"
import { createCompaction, viewImage, type RetryOptions } from "@harness/std/middleware"
import { createAvailableSkills } from "@harness/std/tools/skill"
import { createSubagentList } from "@harness/std/tools/task"
import type { ToolDefinition } from "@harness/types"

/**
 * Builds the primary orchestration agent. The atom declares what it needs (a
 * chat model, a cheap summarizer for compaction, its tools, and the two
 * catalogues it announces); the composition root decides what satisfies them.
 *
 * @param deps.model - the chat model this agent runs on
 * @param deps.summarizer - the model compaction summarizes older history with
 * @param deps.tools - the tools it may call
 * @param deps.skills - the skill catalogue it announces
 * @param deps.agents - the agent registry it announces delegates from
 * @param deps.retry - model-call retry bounds
 */
export function createLeadAgent(deps: {
  model: Model
  summarizer: Model
  tools: ToolDefinition[]
  skills: SkillRegistry
  agents: AgentRegistry
  retry?: RetryOptions
}): HarnessAgent {
  return defineHarnessAgent({
    name: "lead",
    description: "Primary orchestration agent and execution entry point.",
    mode: "primary",
    model: deps.model,
    instructions: LEAD_INSTRUCTIONS,
    tools: deps.tools,
    // The lead runs whole deliverables in one context: loading a skill, reading
    // its assets, then writing a document skeleton and filling it in section by
    // section.
    // Both bounds are sized for that shape rather than for a short Q&A turn.
    steps: 20,
    maxToolCalls: 32,
    // One contributor per capability-bearing tool above: `skill` announces what
    // it can load, `task` announces who it can delegate to.
    middleware: [
      ...baseMiddleware([createAvailableSkills({ skills: deps.skills }), createSubagentList({ agents: deps.agents })], deps.retry),
      viewImage,
      createCompaction({ summarizer: deps.summarizer }),
    ],
  })
}

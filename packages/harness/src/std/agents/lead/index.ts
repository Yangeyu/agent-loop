import { LEAD_INSTRUCTIONS } from "@harness/std/agents/lead/prompt"
import { baseMiddleware } from "@harness/std/agents/shared/base-middleware"
import { defineAgent, type AgentDefinition } from "@harness/agent/blueprint"
import type { Model } from "@harness/llm/types"
import { createCompaction, viewImage, type RetryOptions } from "@harness/std/middleware"
import { availableSkills } from "@harness/std/tools/skill"
import { subagentList } from "@harness/std/tools/task"

/**
 * Builds the primary orchestration agent. The atom declares what it needs (a
 * chat model and a cheap summarizer for compaction); the composition root
 * decides which provider satisfies them.
 *
 * @param deps.model - the chat model this agent runs on
 * @param deps.summarizer - the model compaction summarizes older history with
 * @param deps.retry - model-call retry bounds
 */
export function createLeadAgent(deps: { model: Model; summarizer: Model; retry?: RetryOptions }): AgentDefinition {
  return defineAgent({
    name: "lead",
    description: "Primary orchestration agent and execution entry point.",
    mode: "primary",
    model: deps.model,
    instructions: LEAD_INSTRUCTIONS,
    tools: {
      task: true,
      task_resume: true,
      read: true,
      write: true,
      edit: true,
      grep: true,
      tavily: true,
      present_files: true,
      bash: true,
      skill: true,
      view_image: true,
    },
    // The lead runs whole deliverables in one context: loading a skill, reading
    // its assets, then writing a document skeleton and filling it in section by
    // section.
    // Both bounds are sized for that shape rather than for a short Q&A turn.
    steps: 20,
    maxToolCalls: 32,
    // One contributor per capability-bearing tool above: `skill` announces what
    // it can load, `task` announces who it can delegate to.
    middleware: [
      ...baseMiddleware([availableSkills, subagentList], deps.retry),
      viewImage,
      createCompaction({ summarizer: deps.summarizer }),
    ],
  })
}

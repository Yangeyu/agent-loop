import { subagentList } from "@harness/std/agents/lead/middleware"
import { LEAD_INSTRUCTIONS } from "@harness/std/agents/lead/prompt"
import { baseMiddleware } from "@harness/std/agents/shared/base-middleware"
import { BASE_AGENT_INSTRUCTIONS } from "@harness/std/agents/shared/base-prompt"
import { defineAgent, type AgentDefinition } from "@harness/agent/blueprint"
import type { Model } from "@harness/llm/types"
import { createCompaction, viewImage } from "@harness/std/middleware"

/**
 * Builds the primary orchestration agent. The atom declares what it needs (a
 * chat model and a cheap summarizer for compaction); the composition root
 * decides which provider satisfies them.
 *
 * @param deps.model - the chat model this agent runs on
 * @param deps.summarizer - the model compaction summarizes older history with
 */
export function createLeadAgent(deps: { model: Model; summarizer: Model }): AgentDefinition {
  return defineAgent({
    name: "lead",
    description: "Primary orchestration agent and execution entry point.",
    mode: "primary",
    model: deps.model,
    instructions: [...BASE_AGENT_INSTRUCTIONS, ...LEAD_INSTRUCTIONS],
    tools: {
      task: true,
      task_resume: true,
      read: true,
      read_file: true,
      grep: true,
      tavily: true,
      present_files: true,
      bash: true,
      skill: true,
      view_image: true,
    },
    steps: 12,
    middleware: [...baseMiddleware(), subagentList, viewImage, createCompaction({ summarizer: deps.summarizer })],
  })
}

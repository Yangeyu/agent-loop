import { subagentList } from "@harness/agent/lead/middleware"
import { LEAD_INSTRUCTIONS } from "@harness/agent/lead/prompt"
import { baseMiddleware } from "@harness/agent/shared/base-middleware"
import { BASE_AGENT_INSTRUCTIONS } from "@harness/agent/shared/base-prompt"
import { defineAgent } from "@harness/agent/types"
import { createDashScopeModel } from "@harness/llm/providers/dashscope"
import { compaction, viewImage } from "@harness/middleware"

export const leadAgent = defineAgent({
  name: "lead",
  description: "Primary orchestration agent and execution entry point.",
  mode: "primary",
  model: createDashScopeModel({ modelID: "qwen3.7-plus" }),
  instructions: [...BASE_AGENT_INSTRUCTIONS, ...LEAD_INSTRUCTIONS],
  tools: {
    task: true,
    task_resume: true,
    read: true,
    grep: true,
    present_files: true,
    bash: true,
    skill: true,
    view_image: true,
  },
  steps: 12,
  middleware: [...baseMiddleware(), subagentList, viewImage, compaction],
})

import { deliverableGuidance } from "@harness/agent/general/middleware"
import { GENERAL_INSTRUCTIONS } from "@harness/agent/general/prompt"
import { baseMiddleware } from "@harness/agent/shared/base-middleware"
import { BASE_AGENT_INSTRUCTIONS } from "@harness/agent/shared/base-prompt"
import { defineAgent } from "@harness/agent/types"
import { createDashScopeModel } from "@harness/llm/providers/dashscope"

export const generalAgent = defineAgent({
  name: "general",
  description: "General-purpose subagent for multistep delegated work.",
  mode: "subagent",
  model: createDashScopeModel({ modelID: "qwen3.7-plus" }),
  instructions: [...BASE_AGENT_INSTRUCTIONS, ...GENERAL_INSTRUCTIONS],
  tools: {
    batch: true,
    read: true,
    grep: true,
    present_files: true,
    bash: true,
    skill: true,
  },
  steps: 4,
  middleware: [...baseMiddleware(), deliverableGuidance],
})

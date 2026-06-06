import { BUILD_AGENT_PROMPT, GENERAL_AGENT_PROMPT } from "@harness/agent/prompts"
import type { AgentInfo } from "@harness/types"

export const coreAgents: AgentInfo[] = [
  {
    name: "build",
    mode: "primary",
    prompt: BUILD_AGENT_PROMPT,
    tools: {
      task: true,
      task_resume: true,
      batch: true,
      read: true,
      grep: true,
      present_files: true,
      bash: true,
      skill: true,
    },
    steps: 12,
  },
  {
    name: "general",
    mode: "subagent",
    prompt: GENERAL_AGENT_PROMPT,
    tools: {
      batch: true,
      read: true,
      grep: true,
      present_files: true,
      bash: true,
      skill: true,
    },
    steps: 4,
  },
]

import { generalAgent } from "@harness/agent/general"
import { leadAgent } from "@harness/agent/lead"
import type { AgentDefinition } from "@harness/agent/types"

// lead = primary orchestrator (execution entry); general = delegated subagent.
export const coreAgents: AgentDefinition[] = [leadAgent, generalAgent]

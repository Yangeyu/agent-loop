// Instruction fragments shared by all agents. Agents spread these into their
// own `instructions`; agent-specific guidance lives in each agent directory.
export const BASE_AGENT_INSTRUCTIONS: string[] = [
  "Prefer dedicated tools over shell commands when a tool fits the task.",
  "Ground every step in actual tool results rather than assumptions.",
]

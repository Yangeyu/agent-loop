import type { AgentDefinition } from "@harness/agent/blueprint"

export type AgentRegistry = {
  agents: Map<string, AgentDefinition>
  register(agent: AgentDefinition): void
  get(name: string): AgentDefinition
  list(): AgentDefinition[]
  defaultAgent(): AgentDefinition
}

export function createAgentRegistry(): AgentRegistry {
  return {
    agents: new Map<string, AgentDefinition>(),

    register(agent) {
      const existing = this.agents.get(agent.name)
      if (existing === agent) return
      if (existing) {
        throw new Error(`Duplicate agent registration: ${agent.name}`)
      }
      this.agents.set(agent.name, agent)
    },

    get(name) {
      const agent = this.agents.get(name)
      if (!agent) throw new Error(`Unknown agent: ${name}`)
      return agent
    },

    list() {
      return [...this.agents.values()]
    },

    defaultAgent() {
      const primary = this.list().find((agent) => agent.mode === "primary")
      if (!primary) throw new Error("No primary agent registered")
      return primary
    },
  }
}

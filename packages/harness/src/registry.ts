// Agent lookup by name, plus the one attribute this layer adds to a blueprint:
// whether an agent is the entry point or something to delegate to. `mode` lives
// here because a general loop runs one agent and has no notion of delegation —
// its readers are `defaultAgent` below and the task tool's admission check.
import { defineAgent, type AgentDefinition, type AgentSpec } from "@agent-core"

export type AgentMode = "primary" | "subagent"

/** A blueprint plus its role in this runtime's agent set. */
export type HarnessAgent = AgentDefinition & { mode: AgentMode }

export function defineHarnessAgent(spec: AgentSpec & { mode: AgentMode }): HarnessAgent {
  return { ...defineAgent(spec), mode: spec.mode }
}

export type AgentRegistry = {
  agents: Map<string, HarnessAgent>
  register(agent: HarnessAgent): void
  get(name: string): HarnessAgent
  list(): HarnessAgent[]
  defaultAgent(): HarnessAgent
}

export function createAgentRegistry(): AgentRegistry {
  return {
    agents: new Map<string, HarnessAgent>(),

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

/**
 * Agent lookup by name, plus the one attribute this layer adds at
 * registration: whether an agent is the entry point or something to delegate
 * to. `mode` is registration data, not part of the agent — the same Agent
 * could serve either role in another runtime, so creation stays agent-core's
 * createAgent with nothing wrapped around it.
 */
import type { Agent, Sessions } from "@agent-core"

export type AgentMode = "primary" | "subagent"

/** One registry row: a runnable agent and its role in this runtime's set. */
export type AgentRegistration = { agent: Agent; mode: AgentMode }

export type AgentRegistry = {
  agents: Map<string, AgentRegistration>
  register(agent: Agent, options: { mode: AgentMode }): void
  get(name: string): Agent
  list(): AgentRegistration[]
  defaultAgent(): Agent
}

/**
 * Creates the runtime's agent registry. Registration admits only agents built
 * on this runtime's session store — an agent carrying a different store would
 * fail far away (an unknown session at delegation time), so the mismatch is
 * rejected here, at composition.
 *
 * @param runtime - the store this registry's agents must run on
 */
export function createAgentRegistry(runtime: { sessions: Sessions }): AgentRegistry {
  return {
    agents: new Map<string, AgentRegistration>(),

    register(agent, options) {
      const name = agent.definition.name
      if (agent.sessions !== runtime.sessions) {
        throw new Error(`Agent "${name}" runs on a different session store than this runtime`)
      }
      if (this.agents.has(name)) {
        throw new Error(`Duplicate agent registration: ${name}`)
      }
      this.agents.set(name, { agent, mode: options.mode })
    },

    get(name) {
      const entry = this.agents.get(name)
      if (!entry) throw new Error(`Unknown agent: ${name}`)
      return entry.agent
    },

    list() {
      return [...this.agents.values()]
    },

    defaultAgent() {
      const primary = this.list().find((entry) => entry.mode === "primary")
      if (!primary) throw new Error("No primary agent registered")
      return primary.agent
    },
  }
}

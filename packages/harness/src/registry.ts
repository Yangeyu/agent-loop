/**
 * Agent lookup by name, plus the one attribute this layer adds to a runnable
 * agent: whether it is the entry point or something to delegate to. `mode`
 * lives here because a general loop runs one agent and has no notion of
 * delegation — its readers are `defaultAgent` below and the task tool's
 * admission check.
 */
import { createAgent, type Agent, type CreateAgentSpec, type EngineDeps, type Sessions } from "@agent-core"

export type AgentMode = "primary" | "subagent"

/** A runnable agent plus its role in this runtime's agent set. */
export type HarnessAgent = Agent & { mode: AgentMode }

/**
 * Creates an agent for this runtime: agent-core's createAgent on the runtime's
 * own engine deps, plus its role in the set. `name` and `deps` are required —
 * an orchestrated agent is resolved by name and always runs on the runtime's
 * shared store and bus; the private-engine default is the embedder's, not the
 * orchestrator's.
 *
 * @param spec - the blueprint fields, the runtime's EngineDeps, and the role
 */
export function createHarnessAgent(spec: CreateAgentSpec & { name: string; deps: EngineDeps; mode: AgentMode }): HarnessAgent {
  return { ...createAgent(spec), mode: spec.mode }
}

export type AgentRegistry = {
  agents: Map<string, HarnessAgent>
  register(agent: HarnessAgent): void
  get(name: string): HarnessAgent
  list(): HarnessAgent[]
  defaultAgent(): HarnessAgent
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
    agents: new Map<string, HarnessAgent>(),

    register(agent) {
      const name = agent.definition.name
      if (agent.sessions !== runtime.sessions) {
        throw new Error(`Agent "${name}" runs on a different session store than this runtime`)
      }
      const existing = this.agents.get(name)
      if (existing === agent) return
      if (existing) {
        throw new Error(`Duplicate agent registration: ${name}`)
      }
      this.agents.set(name, agent)
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

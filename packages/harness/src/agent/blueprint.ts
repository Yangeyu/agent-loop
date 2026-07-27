// The agent blueprint: the static half of the atom. A definition pairs a
// capability surface (instruction fragments, tool allowlist, middleware set)
// with a bound model instance — the two orthogonal halves of an agent. The
// model is a concrete Model (built by a provider's createXxxModel), so there
// is no per-request routing. The runnable half lives in create-agent.ts.
import type { Model } from "@harness/llm/types"
import type { MiddlewareFactory } from "@harness/agent/hooks"
import type { OutputFormat } from "@harness/types"

export type AgentDefinition = {
  name: string
  description?: string
  mode: "primary" | "subagent"
  model: Model
  // The agent's own words. The engine seeds these into the context draft so an
  // agent with zero middleware still speaks its blueprint; how they are ordered
  // against everything else in the system prompt is std's business, not the
  // kernel's (see std/prompt).
  instructions: string[]
  tools: Record<string, boolean>
  steps?: number
  // Cap on tool calls across the agent's whole run, mirroring how `steps` caps
  // its turns. Falls back to the runtime default when unset.
  maxToolCalls?: number
  format?: OutputFormat
  // Executed when an AgentRun is created; returns the middleware that compose
  // this agent's capabilities (loop-scoped, instantiated per run).
  assemble(): { middleware: MiddlewareFactory[] }
}

export type AgentSpec = {
  name: string
  description?: string
  mode: "primary" | "subagent"
  // The agent's model instance, built by a provider factory (e.g.
  // createDashScopeModel({ modelID })). Required: an agent has no model until one
  // is bound at its composition site.
  model: Model
  instructions?: string[]
  tools?: Record<string, boolean>
  steps?: number
  maxToolCalls?: number
  format?: OutputFormat
  middleware?: MiddlewareFactory[]
}

export function defineAgent(spec: AgentSpec): AgentDefinition {
  const middleware = spec.middleware ?? []
  return {
    name: spec.name,
    description: spec.description,
    mode: spec.mode,
    model: spec.model,
    instructions: spec.instructions ?? [],
    tools: spec.tools ?? {},
    steps: spec.steps,
    maxToolCalls: spec.maxToolCalls,
    format: spec.format,
    assemble: () => ({ middleware }),
  }
}

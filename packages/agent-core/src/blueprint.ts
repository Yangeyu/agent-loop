// The agent blueprint: the static half of the atom. A definition pairs a
// capability surface (instruction fragments, tools, middleware set) with a bound
// model instance — the two orthogonal halves of an agent. The model is a
// concrete Model (built by a provider's createXxxModel), so there is no
// per-request routing. The runnable half lives in create-agent.ts.
import type { Model } from "@agent-core/llm/types"
import type { MiddlewareFactory } from "@agent-core/hooks"
import type { OutputFormat, ToolDefinition } from "@agent-core/types"

export type AgentDefinition = {
  name: string
  description?: string
  model: Model
  // The agent's own words. The engine seeds these into the context draft so an
  // agent with zero middleware still speaks its blueprint; how they are ordered
  // against everything else in the system prompt is the composition layer's
  // business, not the kernel's (see std/prompt).
  instructions: string[]
  // The tools themselves, not names to look up. Resolving names against a
  // registry is a convenience for configuration; a loop runs what it holds.
  tools: ToolDefinition[]
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
  // The agent's model instance, built by a provider factory (e.g.
  // createDashScopeModel({ modelID })). Required: an agent has no model until one
  // is bound at its composition site.
  model: Model
  instructions?: string[]
  tools?: ToolDefinition[]
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
    model: spec.model,
    instructions: spec.instructions ?? [],
    tools: spec.tools ?? [],
    steps: spec.steps,
    maxToolCalls: spec.maxToolCalls,
    format: spec.format,
    assemble: () => ({ middleware }),
  }
}

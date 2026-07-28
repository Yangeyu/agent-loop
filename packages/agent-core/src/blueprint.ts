// The agent blueprint: the static half of an agent. The runnable half lives
// in create-agent.ts.
import type { Model } from "@agent-core/llm/types"
import type { MiddlewareFactory } from "@agent-core/hooks"
import type { OutputFormat, ToolDefinition } from "@agent-core/types"

/**
 * A capability surface (instructions, tools, middleware) bound to a concrete
 * model instance.
 */
export type AgentDefinition = {
  name: string
  description?: string
  model: Model
  /** Instruction fragments the engine seeds into the system prompt. */
  instructions: string[]
  /** The agent's tool set. */
  tools: ToolDefinition[]
  /** Cap on turns per run; falls back to the runtime default when unset. */
  steps?: number
  /** Cap on tool calls per run; falls back to the runtime default when unset. */
  maxToolCalls?: number
  format?: OutputFormat
  /** Instantiates the agent's middleware, once per run. */
  assemble(): { middleware: MiddlewareFactory[] }
}

/** Input to defineAgent. Collection fields default to empty. */
export type AgentSpec = {
  name: string
  description?: string
  /** A bound model instance, built by a provider factory. */
  model: Model
  instructions?: string[]
  tools?: ToolDefinition[]
  steps?: number
  maxToolCalls?: number
  format?: OutputFormat
  middleware?: MiddlewareFactory[]
}

/** Builds an AgentDefinition from a spec. */
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

// AgentDefinition is the static blueprint registered for each agent type.
// It declares the model, prompt template, tool allowlist, and an assemble()
// that produces the loop-scoped middleware stack for an AgentRun.
import type { ModelSelector } from "@harness/agent/model"
import type { MiddlewareFactory } from "@harness/hooks/types"
import type { OutputFormat } from "@harness/types"

export type AgentDefinition = {
  name: string
  description?: string
  mode: "primary" | "subagent"
  model: ModelSelector
  // The agent's own instruction fragments; rendered by the context-assembly
  // middleware alongside the shared base prompt. Named `instructions` (not
  // `prompt`) so AgentDefinition stays structurally assignable to AgentInfo.
  instructions: string[]
  tools: Record<string, boolean>
  steps?: number
  format?: OutputFormat
  // Executed when an AgentRun is created; returns the middleware that compose
  // this agent's capabilities (loop-scoped, instantiated per run).
  assemble(): { middleware: MiddlewareFactory[] }
}

export type AgentSpec = {
  name: string
  description?: string
  mode: "primary" | "subagent"
  model?: ModelSelector
  instructions?: string[]
  tools?: Record<string, boolean>
  steps?: number
  format?: OutputFormat
  // Either pass a flat middleware list, or a full assemble() for ordering control.
  middleware?: MiddlewareFactory[]
  assemble?: () => { middleware: MiddlewareFactory[] }
}

const DEFAULT_MODEL: ModelSelector = {
  providerID: "dashscope",
  modelID: "qwen3.7-plus",
  temperature: 0.2,
}

export function defineAgent(spec: AgentSpec): AgentDefinition {
  const middleware = spec.middleware ?? []
  return {
    name: spec.name,
    description: spec.description,
    mode: spec.mode,
    model: spec.model ?? DEFAULT_MODEL,
    instructions: spec.instructions ?? [],
    tools: spec.tools ?? {},
    steps: spec.steps,
    format: spec.format,
    assemble: spec.assemble ?? (() => ({ middleware })),
  }
}

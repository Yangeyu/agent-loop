/**
 * createAgent: the single door through which a runnable agent is made. The
 * spec is the blueprint half (name, model, instructions, tools, middleware);
 * `deps` is the environment half — inject a runtime's EngineDeps to share its
 * sessions and event bus, or omit it for a private in-memory engine
 * (createEngineDeps). An agent needing skills, delegation, or a file tree
 * composes them in as tools and middleware.
 */
import { defineAgent, type AgentDefinition } from "@agent-core/blueprint"
import { createEngineDeps, type EngineDeps } from "@agent-core/context"
import { runLoop } from "@agent-core/loop"
import type { RuntimeEventBus } from "@agent-core/event/bus"
import type { Model } from "@agent-core/llm/types"
import type { MiddlewareFactory } from "@agent-core/hooks"
import type { Sessions } from "@agent-core/session"
import {
  createID,
  type ImageSource,
  type OutputFormat,
  type SessionInfo,
  type ToolDefinition,
  type UserMessage,
} from "@agent-core/types"

/** The blueprint half plus the optional environment half. */
export type CreateAgentSpec = {
  name?: string
  description?: string
  model: Model
  instructions?: string[]
  middleware?: MiddlewareFactory[]
  tools?: ToolDefinition[]
  steps?: number
  maxToolCalls?: number
  format?: OutputFormat
  /** The engine environment to run on; omitted = a private in-memory engine. */
  deps?: EngineDeps
}

/** One run request: the user text, and which session answers it (new when unset). */
export type AgentRunInput = {
  text: string
  sessionID?: string
  format?: OutputFormat
  images?: ImageSource[]
  abort?: AbortSignal
}

/**
 * A runnable agent: its blueprint, the environment it runs on, and run().
 * `sessions` and `events` are the agent's resolved environment — the injected
 * ones when deps were given, the private engine's otherwise.
 */
export type Agent = {
  definition: AgentDefinition
  sessions: Sessions
  events: RuntimeEventBus
  run(input: AgentRunInput): Promise<SessionInfo>
}

/**
 * Creates a runnable agent from a spec. Sessions are selected per run() call,
 * so one agent instance serves any number of sessions on its store.
 *
 * @param spec - the blueprint fields plus the optional engine environment
 * @returns the runnable agent
 */
export function createAgent(spec: CreateAgentSpec): Agent {
  const definition = defineAgent({
    name: spec.name ?? "agent",
    description: spec.description,
    model: spec.model,
    instructions: spec.instructions,
    tools: spec.tools,
    steps: spec.steps,
    maxToolCalls: spec.maxToolCalls,
    format: spec.format,
    middleware: spec.middleware ?? [],
  })
  const deps = spec.deps ?? createEngineDeps()

  return {
    definition,
    sessions: deps.sessions,
    events: deps.events,
    async run(input: AgentRunInput): Promise<SessionInfo> {
      const session = input.sessionID
        ? deps.sessions.get(input.sessionID)
        : deps.sessions.create({ title: definition.name })

      seedUserMessage(deps, definition, session.id, input)
      return runLoop(deps, { sessionID: session.id, agent: definition, abort: input.abort })
    },
  }
}

// The one implementation of run seeding: append the user message (text +
// images) and announce the run on the loop channel.
function seedUserMessage(
  deps: EngineDeps,
  definition: AgentDefinition,
  sessionID: string,
  input: { text: string; format?: OutputFormat; images?: ImageSource[] },
) {
  const user: UserMessage = {
    id: createID(),
    role: "user",
    agent: definition.name,
    format: input.format ?? definition.format,
    time: { created: Date.now() },
  }

  deps.sessions.appendMessage(sessionID, user)
  deps.sessions.appendPart(sessionID, user.id, { id: createID(), type: "text", text: input.text })
  for (const source of input.images ?? []) {
    deps.sessions.appendPart(sessionID, user.id, { id: createID(), type: "image", source })
  }

  deps.events.loop.emit({
    type: "session.start",
    sessionID,
    rootID: deps.sessions.get(sessionID).rootID,
    agent: definition.name,
    text: input.text,
  })
}

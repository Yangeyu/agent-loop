/**
 * The agent: its definition and the single door through which a runnable one
 * is made. The spec is the blueprint half (name, model, instructions, tools,
 * middleware); `deps` is the environment half — inject a runtime's EngineDeps
 * to share its sessions and event bus, or omit it for a private in-memory
 * engine (createEngineDeps). An agent needing skills, delegation, or a file
 * tree composes them in as tools and middleware.
 */
import { createEngineDeps, type EngineDeps } from "@agent-core/context"
import { runLoop } from "@agent-core/engine/loop"
import type { RuntimeEventBus } from "@agent-core/events"
import type { Model } from "@agent-core/llm/types"
import type { MiddlewareFactory } from "@agent-core/hooks"
import type { Sessions } from "@agent-core/session"
import { createID, type ImageSource, type OutputFormat, type SessionInfo, type UserMessage } from "@agent-core/model"
import type { ToolDefinition } from "@agent-core/tool/tool"

/** The blueprint half plus the optional environment half. */
export type CreateAgentSpec = {
  name?: string
  description?: string
  /** A bound model instance, built by a provider factory. */
  model: Model
  /** Instruction fragments the engine seeds into the system prompt. */
  instructions?: string[]
  middleware?: MiddlewareFactory[]
  tools?: ToolDefinition[]
  /** Cap on steps per run; falls back to the runtime default when unset. */
  steps?: number
  /** Cap on tool calls per run; falls back to the runtime default when unset. */
  maxToolCalls?: number
  format?: OutputFormat
  /** The engine environment to run on; omitted = a private in-memory engine. */
  deps?: EngineDeps
}

/**
 * A capability surface (instructions, tools, middleware) bound to a concrete
 * model instance — the static half of an agent, the view middleware and the
 * engine read.
 */
export type AgentDefinition = {
  name: string
  description?: string
  model: Model
  instructions: string[]
  tools: ToolDefinition[]
  steps?: number
  maxToolCalls?: number
  format?: OutputFormat
  /** Instantiates the agent's middleware, once per run. */
  assemble(): { middleware: MiddlewareFactory[] }
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
  const definition = defineAgent(spec)
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

/** Normalizes a spec into the definition: names the agent, defaults collections. */
export function defineAgent(spec: Omit<CreateAgentSpec, "deps">): AgentDefinition {
  const middleware = spec.middleware ?? []
  return {
    name: spec.name ?? "agent",
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

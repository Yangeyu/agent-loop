// The runnable half of the blueprint: createAgent wraps one definition with a
// private set of engine deps (in-memory sessions by default) into a directly
// runnable unit — the same engine machinery the full runtime assembles by
// hand. An agent needing skills, delegation, or a file tree composes them in
// as tools and middleware.
import { defineAgent, type AgentDefinition } from "@agent-core/blueprint"
import { runLoop } from "@agent-core/loop"
import { DEFAULT_CORE_CONFIG, type CoreConfig } from "@agent-core/config"
import { createRuntimeEvents, type RuntimeEventBus } from "@agent-core/event/bus"
import type { Model } from "@agent-core/llm/types"
import type { MiddlewareFactory } from "@agent-core/hooks"
import { createSessionPersistence, Sessions } from "@agent-core/session"
import {
  createID,
  type ImageSource,
  type OutputFormat,
  type SessionInfo,
  type ToolDefinition,
  type UserMessage,
} from "@agent-core/types"

/** The standalone-agent configuration: a model plus whatever bricks it composes. */
export type StandaloneAgentSpec = {
  name?: string
  model: Model
  instructions?: string[]
  middleware?: MiddlewareFactory[]
  tools?: ToolDefinition[]
  steps?: number
  format?: OutputFormat
  config?: Partial<CoreConfig>
  /** An external bus to observe the agent on; a private one is created otherwise. */
  events?: RuntimeEventBus
}

/**
 * The standalone agent: model + tools + middleware wrapped into a single
 * runnable unit with private engine deps (in-memory sessions by default).
 * This entry is for embedding one agent directly.
 *
 * The engine deps stay private — the facade exposes only what an embedder
 * consumes: the blueprint, run(), the event bus to observe, and the sessions
 * aggregate to read state back.
 *
 * @param spec - the agent's model, bricks, and optional config/events overrides
 * @returns { definition, run, events, sessions }
 */
export function createAgent(spec: StandaloneAgentSpec) {
  const definition = defineAgent({
    name: spec.name ?? "agent",
    model: spec.model,
    instructions: spec.instructions,
    tools: spec.tools,
    steps: spec.steps,
    format: spec.format,
    middleware: spec.middleware ?? [],
  })

  const config: CoreConfig = { ...DEFAULT_CORE_CONFIG, ...(spec.config ?? {}) }
  const events = spec.events ?? createRuntimeEvents()
  const deps = {
    config,
    events,
    sessions: new Sessions(createSessionPersistence(config), events.state),
  }

  return {
    definition,
    events,
    sessions: deps.sessions,
    async run(input: {
      text: string
      sessionID?: string
      format?: OutputFormat
      images?: ImageSource[]
      abort?: AbortSignal
    }): Promise<SessionInfo> {
      const session = input.sessionID
        ? deps.sessions.get(input.sessionID)
        : deps.sessions.create({ title: definition.name })

      seedUserMessage(deps, definition, session.id, input)
      return runLoop(deps, { sessionID: session.id, agent: definition, abort: input.abort })
    },
  }
}

// Appends the run's user message before the loop starts.
function seedUserMessage(
  deps: { sessions: Sessions; events: RuntimeEventBus },
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

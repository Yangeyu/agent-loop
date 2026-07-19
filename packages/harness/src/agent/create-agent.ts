// The runnable half of the atom: createAgent wraps one definition with a
// private set of engine deps (in-memory sessions by default) into a directly
// runnable unit — the same kernel machinery the full runtime assembles by hand.
import { defineAgent, type AgentDefinition } from "@harness/agent/blueprint"
import { createAgentRegistry } from "@harness/agent/registry"
import { runSession } from "@harness/agent/loop"
import { loadConfigFromEnv, type Config } from "@harness/config"
import { createRuntimeEvents, type RuntimeEventBus } from "@harness/event/bus"
import type { Model } from "@harness/llm/types"
import type { MiddlewareFactory } from "@harness/agent/hooks"
import { createSessionPersistence, Sessions } from "@harness/session"
import { createSkillRegistry } from "@harness/skill/registry"
import { createToolRegistry } from "@harness/tool/registry"
import type { AnyToolDefinition, ImageSource, OutputFormat, SessionInfo } from "@harness/types"

/** The standalone-agent configuration: a model plus whatever bricks it composes. */
export type StandaloneAgentSpec = {
  name?: string
  model: Model
  instructions?: string[]
  middleware?: MiddlewareFactory[]
  tools?: AnyToolDefinition[]
  // Delegable subagents, registered alongside (reachable via the task tool).
  subagents?: AgentDefinition[]
  steps?: number
  format?: OutputFormat
  config?: Partial<Config>
  // Observe this atom on an external bus instead of a private one.
  events?: RuntimeEventBus
}

/**
 * The standalone agent atom: model + tools + middleware wrapped into a single
 * runnable unit with private engine deps (in-memory sessions by default). The
 * full-composition path (createRuntime + registries + surfaces) is this same
 * machinery assembled by hand; this entry is for embedding one agent directly.
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
    mode: "primary",
    model: spec.model,
    instructions: spec.instructions,
    tools: Object.fromEntries((spec.tools ?? []).map((tool) => [tool.id, true])),
    steps: spec.steps,
    format: spec.format,
    middleware: spec.middleware ?? [],
  })

  const config: Config = {
    ...loadConfigFromEnv({ ...process.env, SESSION_STORE: "memory" }),
    ...(spec.config ?? {}),
  }
  const events = spec.events ?? createRuntimeEvents()
  const deps = {
    config,
    events,
    sessions: new Sessions(createSessionPersistence(config), events.state),
    agent_registry: createAgentRegistry(),
    skill_registry: createSkillRegistry(),
    tool_registry: createToolRegistry(),
  }
  deps.agent_registry.register(definition)
  for (const subagent of spec.subagents ?? []) deps.agent_registry.register(subagent)
  for (const tool of spec.tools ?? []) deps.tool_registry.register(tool)

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
      const session = input.sessionID ? deps.sessions.get(input.sessionID) : deps.sessions.create({ title: definition.name })
      return runSession(deps, {
        sessionID: session.id,
        text: input.text,
        agent: definition.name,
        format: input.format,
        images: input.images,
        abort: input.abort,
      })
    },
  }
}

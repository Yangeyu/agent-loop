/**
 * Runtime assembly: composition is code. A surface builds its models, calls the
 * agent/tool factories it wants, and hands the flat lists here — there is no
 * plugin or registration indirection in between.
 */
import { createRuntimeContext, type RuntimeContext } from "@harness/runtime/context"
import { loadConfigFromEnv, type Config } from "@harness/config"
import type { MemoryStore } from "@harness/memory/types"
import type { Model, SessionPersistence } from "@agent-core"
import { createCoreAgents } from "@harness/agents"
import { createCoreTools } from "@harness/tools"
import type { SkillInfo } from "@harness/skills/types"
import type { ImageSource, OutputFormat } from "@agent-core"

/**
 * The runtime's assembly inputs. Agents are absent by design: a runnable agent
 * needs the runtime's EngineDeps at creation, so agents are created after the
 * runtime exists and registered on it (see createCoreRuntime). `persistence`
 * and `memory` inject external backends; omitted, config selects the
 * built-ins.
 */
export type RuntimeAssembly = {
  config?: Config
  skills?: SkillInfo[]
  persistence?: SessionPersistence
  memory?: MemoryStore
}

/**
 * Assembles a bare runtime — the escape hatch for an agent set that is not the
 * standard one: create it, then register createAgent({ ..., deps: runtime })
 * results on it. For the standard set, use createCoreRuntime.
 *
 * @param options - config, the skills to register, and an optional session store
 */
export function createRuntime(options?: RuntimeAssembly): RuntimeContext {
  const runtime = createRuntimeContext({
    config: options?.config,
    persistence: options?.persistence,
    memory: options?.memory,
  })
  for (const skill of options?.skills ?? []) runtime.skill_registry.register(skill)
  return runtime
}

/**
 * Assembles the standard agent set on a runtime: skills, then the core tools
 * built against this runtime's collaborators, then the agents holding them. A
 * surface supplies only the models.
 *
 * The order is load-bearing: the task tool reads the agent registry at call
 * time, so it can precede the agents; the agents cannot precede their tools.
 *
 * @param options - the chat and summarizer models, plus optional config/skills
 * @returns the assembled runtime
 */
export function createCoreRuntime(options: {
  chat: Model
  summarizer: Model
  config?: Config
  skills?: SkillInfo[]
  persistence?: SessionPersistence
  memory?: MemoryStore
}): RuntimeContext {
  const runtime = createRuntimeContext({ config: options.config, persistence: options.persistence, memory: options.memory })
  for (const skill of options.skills ?? []) runtime.skill_registry.register(skill)

  const tools = createCoreTools({
    // The chat model is multimodal; view_image reuses it as the vision model.
    visionModel: options.chat,
    workspace: runtime.workspace,
    skills: runtime.skill_registry,
    agents: runtime.agent_registry,
    memory: runtime.memory,
    config: runtime.config,
  })

  const agents = createCoreAgents({
    model: options.chat,
    summarizer: options.summarizer,
    tools,
    skills: runtime.skill_registry,
    agents: runtime.agent_registry,
    memory: runtime.memory,
    retry: {
      maxRetries: runtime.config.model_max_retries,
      baseDelayMs: runtime.config.model_retry_base_delay_ms,
      maxDelayMs: runtime.config.model_retry_max_delay_ms,
    },
    engine: runtime,
  })
  for (const { agent, mode } of agents) runtime.agent_registry.register(agent, { mode })

  return runtime
}

export function createTestRuntime(options?: Omit<RuntimeAssembly, "config"> & { config?: Partial<Config> }): RuntimeContext {
  return createRuntime({ ...options, config: testConfig(options?.config) })
}

/** createCoreRuntime on in-memory config — the standard set, as tests get it. */
export function createCoreTestRuntime(options: {
  chat: Model
  summarizer: Model
  config?: Partial<Config>
  skills?: SkillInfo[]
}): RuntimeContext {
  return createCoreRuntime({ ...options, config: testConfig(options.config) })
}

function testConfig(overrides?: Partial<Config>): Config {
  return { ...loadConfigFromEnv({ ...process.env, SESSION_STORE: "memory" }), ...(overrides ?? {}) }
}

export async function runPrompt(options: {
  runtime: RuntimeContext
  text: string
  agent?: string
  sessionID?: string
  printSessionJson?: boolean
  format?: OutputFormat
  images?: ImageSource[]
  abort?: AbortSignal
}) {
  const { runtime } = options
  const session = options.sessionID
    ? runtime.sessions.get(options.sessionID)
    : runtime.sessions.create({ title: "CLI session" })

  // Resolving by name is the one step the engine leaves to its caller; the
  // agent's own run() seeds the user message and drives the loop.
  const agent = options.agent ? runtime.agent_registry.get(options.agent) : runtime.agent_registry.defaultAgent()
  await agent.run({
    sessionID: session.id,
    text: options.text,
    format: options.format,
    images: options.images,
    abort: options.abort,
  })

  const current = runtime.sessions.get(session.id)
  if (options.printSessionJson) {
    console.log(JSON.stringify(current, null, 2))
  }
  return current
}

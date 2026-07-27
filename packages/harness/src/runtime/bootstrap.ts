// Runtime assembly: composition is code. A surface builds its models, calls the
// agent/tool factories it wants, and hands the flat lists here — there is no
// plugin or registration indirection in between.
import { createRuntimeContext, type RuntimeContext } from "@harness/runtime/context"
import { runSession } from "@harness/session"
import { loadConfigFromEnv, type Config } from "@harness/config"
import type { HarnessAgent } from "@harness/registry"
import type { Model } from "@agent-core"
import { createCoreAgents } from "@harness/agents"
import { createCoreTools } from "@harness/tools"
import type { SkillInfo } from "@harness/skills/types"
import type { ImageSource, OutputFormat } from "@agent-core"

/** The composed capability set a runtime is assembled from. Tools are absent
 *  because an agent holds its own; a runtime-wide tool list has nothing to do. */
export type RuntimeAssembly = {
  config?: Config
  agents?: HarnessAgent[]
  skills?: SkillInfo[]
}

/**
 * Assembles a runtime from explicit lists — the escape hatch for a set that is
 * not the standard one. For the standard one, use createCoreRuntime.
 *
 * @param options - config plus the agents and skills to register
 */
export function createRuntime(options?: RuntimeAssembly): RuntimeContext {
  const runtime = createRuntimeContext({ config: options?.config })
  for (const agent of options?.agents ?? []) runtime.agent_registry.register(agent)
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
}): RuntimeContext {
  const runtime = createRuntimeContext({ config: options.config })
  for (const skill of options.skills ?? []) runtime.skill_registry.register(skill)

  const tools = createCoreTools({
    // The chat model is multimodal; view_image reuses it as the vision model.
    visionModel: options.chat,
    workspace: runtime.workspace,
    skills: runtime.skill_registry,
    agents: runtime.agent_registry,
    config: runtime.config,
  })

  const agents = createCoreAgents({
    model: options.chat,
    summarizer: options.summarizer,
    tools,
    skills: runtime.skill_registry,
    agents: runtime.agent_registry,
    retry: {
      maxRetries: runtime.config.model_max_retries,
      baseDelayMs: runtime.config.model_retry_base_delay_ms,
      maxDelayMs: runtime.config.model_retry_max_delay_ms,
    },
  })
  for (const agent of agents) runtime.agent_registry.register(agent)

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

  await runSession(runtime, {
    sessionID: session.id,
    text: options.text,
    agent: options.agent ?? runtime.agent_registry.defaultAgent().name,
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

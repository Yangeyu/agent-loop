// Runtime assembly: composition is code. A surface builds its models, calls the
// agent/tool factories it wants, and hands the flat lists here — there is no
// plugin or registration indirection in between.
import { createRuntimeContext, type RuntimeContext } from "@harness/runtime/context"
import { runSession } from "@harness/agent/loop"
import { loadConfigFromEnv, type Config } from "@harness/config"
import type { AgentDefinition } from "@harness/agent/blueprint"
import type { SkillInfo } from "@harness/skill/types"
import type { AnyToolDefinition, ImageSource, OutputFormat } from "@harness/types"

/** The composed capability set a runtime is assembled from. */
export type RuntimeAssembly = {
  config?: Config
  agents?: AgentDefinition[]
  tools?: AnyToolDefinition[]
  skills?: SkillInfo[]
}

export function createRuntime(options?: RuntimeAssembly): RuntimeContext {
  const runtime = createRuntimeContext({ config: options?.config })
  for (const tool of options?.tools ?? []) runtime.tool_registry.register(tool)
  for (const agent of options?.agents ?? []) runtime.agent_registry.register(agent)
  for (const skill of options?.skills ?? []) runtime.skill_registry.register(skill)
  return runtime
}

export function createTestRuntime(options?: Omit<RuntimeAssembly, "config"> & { config?: Partial<Config> }): RuntimeContext {
  const config = {
    ...loadConfigFromEnv({ ...process.env, SESSION_STORE: "memory" }),
    ...(options?.config ?? {}),
  }

  return createRuntime({ ...options, config })
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

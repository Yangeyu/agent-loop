import { createRuntimeContext, type RuntimeContext } from "@harness/runtime/context"
import { disposeRuntimePlugins, registerRuntimePlugins } from "@harness/plugin/manager"
import { runSession } from "@harness/core/loop"
import { loadConfigFromEnv, type Config } from "@harness/config"
import type { RuntimePlugin } from "@harness/plugin/types"
import type { ImageSource, OutputFormat } from "@harness/types"

export async function createRuntime(options?: {
  config?: Config
  plugins?: RuntimePlugin[]
}) {
  return registerRuntimePlugins(createRuntimeContext({ config: options?.config }), options?.plugins)
}

export async function createTestRuntime(options?: {
  config?: Partial<Config>
  plugins?: RuntimePlugin[]
}) {
  const config = {
    ...loadConfigFromEnv({ ...process.env, SESSION_STORE: "memory" }),
    ...(options?.config ?? {}),
  }

  return createRuntime({ config, plugins: options?.plugins })
}

export async function disposeRuntime(runtime: RuntimeContext) {
  await disposeRuntimePlugins(runtime)
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

import { createRuntimeContext, type RuntimeContext } from "@harness/runtime/context"
import { disposeRuntimePlugins, registerRuntimePlugins } from "@harness/plugin/manager"
import { SessionPrompt } from "@harness/session/prompt"
import { loadConfigFromEnv, type Config } from "@harness/config"
import type { RuntimePlugin } from "@harness/plugin/types"
import type { UserMessage } from "@harness/types"

export async function createRuntime(options?: { config?: Config; plugins?: RuntimePlugin[] }) {
  return registerRuntimePlugins(createRuntimeContext(options?.config), options?.plugins)
}

export async function createTestRuntime(options?: { config?: Partial<Config>; plugins?: RuntimePlugin[] }) {
  const config = {
    ...loadConfigFromEnv({
      ...process.env,
      SESSION_STORE: "memory",
    }),
    ...(options?.config ?? {}),
  }

  return createRuntime({
    config,
    plugins: options?.plugins,
  })
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
  format?: UserMessage["format"]
  abort?: AbortSignal
}) {
  const { runtime } = options
  const session = options.sessionID
    ? runtime.session_store.get(options.sessionID)
    : runtime.session_store.create({ title: "CLI session" })

  await SessionPrompt.prompt({
    sessionID: session.id,
    text: options.text,
    agent: options.agent ?? runtime.agent_registry.defaultAgent().name,
    format: options.format,
    abort: options.abort,
  }, runtime)

  const current = runtime.session_store.get(session.id)
  if (options.printSessionJson) {
    console.log(JSON.stringify(current, null, 2))
  }
  return current
}

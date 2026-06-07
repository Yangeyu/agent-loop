import { createRuntimeContext, type RuntimeContext } from "@harness/runtime/context"
import { disposeRuntimePlugins, registerRuntimePlugins } from "@harness/plugin/manager"
import { runSession } from "@harness/core/loop"
import { loadConfigFromEnv, type Config } from "@harness/config"
import type { ModelProvider } from "@harness/agent/model"
import type { RuntimePlugin } from "@harness/plugin/types"
import type { OutputFormat } from "@harness/types"

export async function createRuntime(options?: {
  config?: Config
  plugins?: RuntimePlugin[]
  model_provider?: ModelProvider
}) {
  return registerRuntimePlugins(
    createRuntimeContext({ config: options?.config, model_provider: options?.model_provider }),
    options?.plugins,
  )
}

export async function createTestRuntime(options?: {
  config?: Partial<Config>
  plugins?: RuntimePlugin[]
  model_provider?: ModelProvider
}) {
  const config = {
    ...loadConfigFromEnv({ ...process.env, SESSION_STORE: "memory" }),
    ...(options?.config ?? {}),
  }

  return createRuntime({ config, plugins: options?.plugins, model_provider: options?.model_provider })
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
  abort?: AbortSignal
}) {
  const { runtime } = options
  const session = options.sessionID
    ? runtime.session_store.get(options.sessionID)
    : runtime.session_store.create({ title: "CLI session" })

  await runSession(runtime, {
    sessionID: session.id,
    text: options.text,
    agent: options.agent ?? runtime.agent_registry.defaultAgent().name,
    format: options.format,
    abort: options.abort,
  })

  const current = runtime.session_store.get(session.id)
  if (options.printSessionJson) {
    console.log(JSON.stringify(current, null, 2))
  }
  return current
}

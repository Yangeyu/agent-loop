import type { RuntimeContext } from "@harness/runtime/context"
import type { RuntimePlugin } from "@harness/plugin/types"

type RegisteredPluginState = {
  plugins: Map<string, RuntimePlugin>
  dispose: Array<(runtime: RuntimeContext) => void | Promise<void>>
}

const runtimePluginState = new WeakMap<RuntimeContext, RegisteredPluginState>()

function stateFor(runtime: RuntimeContext) {
  const existing = runtimePluginState.get(runtime)
  if (existing) return existing
  const created: RegisteredPluginState = {
    plugins: new Map<string, RuntimePlugin>(),
    dispose: [],
  }
  runtimePluginState.set(runtime, created)
  return created
}

function runtimeDepsFor(runtime: RuntimeContext) {
  return {
    config: runtime.config,
    agent_registry: runtime.agent_registry,
    skill_registry: runtime.skill_registry,
    sessions: runtime.sessions,
    tool_registry: runtime.tool_registry,
    events: runtime.events,
  }
}

function assertNoDuplicatePlugins(plugins: RuntimePlugin[]) {
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      throw new Error(`Duplicate runtime plugin registration: ${plugin.name}`)
    }
    seen.add(plugin.name)
  }
}

export async function registerRuntimePlugins(runtime: RuntimeContext, plugins: RuntimePlugin[] = []) {
  assertNoDuplicatePlugins(plugins)
  const state = stateFor(runtime)

  for (const plugin of plugins) {
    const prior = state.plugins.get(plugin.name)
    if (prior === plugin) continue
    if (prior) {
      throw new Error(`Runtime already registered a different plugin named ${plugin.name}`)
    }

    for (const tool of plugin.tools ?? []) {
      runtime.tool_registry.register(tool)
    }

    for (const agent of plugin.agents ?? []) {
      runtime.agent_registry.register(agent)
    }

    for (const skill of plugin.skills ?? []) {
      runtime.skill_registry.register(skill)
    }

    if (plugin.setup) {
      await plugin.setup(runtimeDepsFor(runtime))
    }

    if (plugin.dispose) {
      state.dispose.unshift(plugin.dispose)
    }

    state.plugins.set(plugin.name, plugin)
  }

  return runtime
}

export async function disposeRuntimePlugins(runtime: RuntimeContext) {
  const state = runtimePluginState.get(runtime)
  if (!state) return

  for (const dispose of state.dispose) {
    await dispose(runtime)
  }

  runtimePluginState.delete(runtime)
}

export function registeredRuntimePlugins(runtime: RuntimeContext) {
  return [...stateFor(runtime).plugins.values()]
}

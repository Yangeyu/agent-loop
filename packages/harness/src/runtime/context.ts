import { getConfig, type Config } from "@harness/config"
import { createAgentRegistry, type AgentRegistry } from "@harness/agent/registry"
import { createRuntimeEvents, type RuntimeEventBus } from "@harness/runtime/events"
import { createRuntimeTrace, type RuntimeTrace } from "@harness/runtime/trace"
import { createSkillRegistry, type SkillRegistry } from "@harness/skill/registry"
import { createSessionStore } from "@harness/session/store/factory"
import { createToolRegistry, type ToolRegistry } from "@harness/tool/registry"
import type { ISessionStore } from "@harness/session/store/types"

export type RuntimeContext = {
  config: Config
  agent_registry: AgentRegistry
  skill_registry: SkillRegistry
  session_store: ISessionStore
  tool_registry: ToolRegistry
  events: RuntimeEventBus
  trace: RuntimeTrace
}

export type RuntimeDeps = Pick<
  RuntimeContext,
  "config" | "agent_registry" | "skill_registry" | "session_store" | "tool_registry" | "events"
>

export function createRuntimeContext(options?: { config?: Config }): RuntimeContext {
  const config = options?.config ?? getConfig()
  const events = createRuntimeEvents()
  const session_store = createSessionStore(config)
  const agent_registry = createAgentRegistry()
  const skill_registry = createSkillRegistry()
  const tool_registry = createToolRegistry()
  const trace = createRuntimeTrace(events)

  return {
    config,
    agent_registry,
    skill_registry,
    session_store,
    tool_registry,
    events,
    trace,
  }
}

import { getConfig, type Config } from "@harness/config"
import { createAgentRegistry, type AgentRegistry } from "@harness/agent/registry"
import { createRuntimeEvents, type RuntimeEventBus } from "@harness/runtime/events"
import { createRuntimeTrace, type RuntimeTrace } from "@harness/runtime/trace"
import { createSkillRegistry, type SkillRegistry } from "@harness/skill/registry"
import { createSessionPersistence, Sessions } from "@harness/session"
import { createToolRegistry, type ToolRegistry } from "@harness/tool/registry"

export type RuntimeContext = {
  config: Config
  agent_registry: AgentRegistry
  skill_registry: SkillRegistry
  sessions: Sessions
  tool_registry: ToolRegistry
  events: RuntimeEventBus
  trace: RuntimeTrace
}

export type RuntimeDeps = Pick<
  RuntimeContext,
  "config" | "agent_registry" | "skill_registry" | "sessions" | "tool_registry" | "events"
>

export function createRuntimeContext(options?: { config?: Config }): RuntimeContext {
  const config = options?.config ?? getConfig()
  const events = createRuntimeEvents()
  // The aggregate is wired to the state channel at construction: every session
  // write emits its event from inside the aggregate, nowhere else.
  const sessions = new Sessions(createSessionPersistence(config), events.state)
  const agent_registry = createAgentRegistry()
  const skill_registry = createSkillRegistry()
  const tool_registry = createToolRegistry()
  const trace = createRuntimeTrace(events)

  return {
    config,
    agent_registry,
    skill_registry,
    sessions,
    tool_registry,
    events,
    trace,
  }
}

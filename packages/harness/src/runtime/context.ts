import { getConfig, type Config } from "@harness/config"
import { createAgentRegistry } from "@harness/agent/registry"
import type { EngineDeps } from "@harness/agent/context"
import { createRuntimeEvents } from "@harness/event/bus"
import { createSkillRegistry } from "@harness/skill/registry"
import { createSessionPersistence, Sessions } from "@harness/session"
import { createToolRegistry } from "@harness/tool/registry"
import { createWorkspace } from "@harness/workspace"

// The runtime context IS the engine's dependency contract — assembly adds
// nothing on top; the kernel (core/context.ts) owns the shape.
export type RuntimeContext = EngineDeps

export function createRuntimeContext(options?: { config?: Config }): RuntimeContext {
  const config = options?.config ?? getConfig()
  const events = createRuntimeEvents()
  // The aggregate is wired to the state channel at construction: every session
  // write emits its event from inside the aggregate, nowhere else.
  const sessions = new Sessions(createSessionPersistence(config), events.state)
  const agent_registry = createAgentRegistry()
  const skill_registry = createSkillRegistry()
  const tool_registry = createToolRegistry()
  const workspace = createWorkspace(config.workspace_root)

  return {
    config,
    agent_registry,
    skill_registry,
    sessions,
    tool_registry,
    events,
    workspace,
  }
}

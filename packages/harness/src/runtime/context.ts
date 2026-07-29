import { getConfig, type Config } from "@harness/config"
import { createAgentRegistry, type AgentRegistry } from "@harness/registry"
import type { EngineDeps, SessionPersistence } from "@agent-core"
import { createRuntimeEvents, Sessions } from "@agent-core"
import { createSessionPersistence } from "@harness/persistence"
import { createSkillRegistry, type SkillRegistry } from "@harness/skills/registry"
import { createWorkspace, type Workspace } from "@harness/workspace"

/**
 * The orchestration layer's assembled collaborators: the engine's dependencies
 * plus the catalogues and the file tree its tools are built from. The two halves
 * are separate types on purpose — knowing what a skill is, or where the files
 * are, is this layer's business and not the loop's.
 */
export type RuntimeContext = EngineDeps & {
  config: Config
  agent_registry: AgentRegistry
  skill_registry: SkillRegistry
  workspace: Workspace
}

export function createRuntimeContext(options?: { config?: Config; persistence?: SessionPersistence }): RuntimeContext {
  const config = options?.config ?? getConfig()
  const events = createRuntimeEvents()
  // An injected backend wins; the config string selects among the built-ins.
  // The aggregate is wired to the state channel at construction: every session
  // write emits its event from inside the aggregate, nowhere else.
  const sessions = new Sessions(options?.persistence ?? createSessionPersistence(config), events.state)

  return {
    config,
    sessions,
    events,
    // The registry admits only agents built on this runtime's store.
    agent_registry: createAgentRegistry({ sessions }),
    skill_registry: createSkillRegistry(),
    workspace: createWorkspace(config.workspace_root),
  }
}

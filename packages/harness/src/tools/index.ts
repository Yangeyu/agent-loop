import { createGrepTool } from "@harness/tools/grep"
import { createBashTool } from "@harness/tools/bash"
import { createEditTool } from "@harness/tools/edit"
import { createMemoryForgetTool, createMemoryReadTool, createMemorySaveTool } from "@harness/tools/memory"
import { createPresentFilesTool } from "@harness/tools/present-files"
import { createReadTool } from "@harness/tools/read"
import { createSkillTool } from "@harness/tools/skill"
import { createTaskResumeTool, createTaskTool } from "@harness/tools/task"
import { TavilyTool } from "@harness/tools/tavily"
import { createViewImageTool } from "@harness/tools/view-image"
import { createWriteTool } from "@harness/tools/write"
import type { AgentRegistry } from "@harness/registry"
import type { Config } from "@harness/config"
import type { MemoryStore } from "@harness/memory/types"
import type { Model } from "@agent-core"
import type { SkillRegistry } from "@harness/skills/registry"
import type { ToolDefinition } from "@agent-core"
import type { Workspace } from "@harness/workspace"

/** Everything the core tool set needs, named by the tools that need it. */
export type CoreToolDeps = {
  visionModel: Model
  workspace: Workspace
  skills: SkillRegistry
  agents: AgentRegistry
  memory: MemoryStore
  config: Config
}

/**
 * Builds the core tool set. Each tool holds what it needs in its own closure,
 * which is what keeps the loop's context down to sessions/events/config.
 *
 * `agents` arrives as the registry rather than a list because the task tool
 * reads it at call time — it must exist before the agents that enable it.
 *
 * @param deps - the vision model, workspace, skill catalogue, agent registry, config
 */
export function createCoreTools(deps: CoreToolDeps): ToolDefinition[] {
  const { workspace } = deps
  return [
    createTaskTool({ agents: deps.agents, config: deps.config }),
    createTaskResumeTool({ agents: deps.agents, config: deps.config }),
    createBashTool({ workspace }),
    createReadTool({ workspace }),
    createWriteTool({ workspace }),
    createEditTool({ workspace }),
    createGrepTool({ workspace }),
    TavilyTool,
    createPresentFilesTool({ workspace }),
    createSkillTool({ skills: deps.skills, workspace }),
    createViewImageTool({ model: deps.visionModel, workspace }),
    createMemorySaveTool({ memory: deps.memory }),
    createMemoryReadTool({ memory: deps.memory }),
    createMemoryForgetTool({ memory: deps.memory }),
  ]
}

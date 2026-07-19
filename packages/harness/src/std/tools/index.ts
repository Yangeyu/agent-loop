import { GrepTool, ReadTool } from "@harness/std/tools/basic"
import { BashTool } from "@harness/std/tools/bash"
import { PresentFilesTool } from "@harness/std/tools/present-files"
import { ReadFileTool } from "@harness/std/tools/read-file"
import { SkillTool } from "@harness/std/tools/skill"
import { TaskResumeTool, TaskTool } from "@harness/std/tools/task"
import { TavilyTool } from "@harness/std/tools/tavily"
import { createViewImageTool } from "@harness/std/tools/view-image"
import type { Model } from "@harness/llm/types"
import type { AnyToolDefinition } from "@harness/types"

/**
 * Builds the core tool set. Only view_image needs a dependency (the vision
 * model); everything else is a static definition.
 *
 * @param deps.visionModel - the multimodal Model backing the view_image tool
 */
export function createCoreTools(deps: { visionModel: Model }): AnyToolDefinition[] {
  return [
    TaskTool,
    TaskResumeTool,
    BashTool,
    ReadTool,
    ReadFileTool,
    GrepTool,
    TavilyTool,
    PresentFilesTool,
    SkillTool,
    createViewImageTool({ model: deps.visionModel }),
  ]
}

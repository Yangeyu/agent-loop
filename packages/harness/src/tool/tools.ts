import { GrepTool, ReadTool } from "@harness/tool/basic"
import { BashTool } from "@harness/tool/bash"
import { PresentFilesTool } from "@harness/tool/present-files"
import { ReadFileTool } from "@harness/tool/read-file"
import { SkillTool } from "@harness/tool/skill"
import { TaskResumeTool, TaskTool } from "@harness/tool/task"
import { TavilyTool } from "@harness/tool/tavily"
import { ViewImageTool } from "@harness/tool/view-image"
import type { AnyToolDefinition } from "@harness/types"

export const coreTools: AnyToolDefinition[] = [
  TaskTool,
  TaskResumeTool,
  BashTool,
  ReadTool,
  ReadFileTool,
  GrepTool,
  TavilyTool,
  PresentFilesTool,
  SkillTool,
  ViewImageTool,
]

// The board domain as one cohesive unit: agents (model-injected factories),
// tools, and skills. Grouping is expressed by this module itself — the runtime
// has no plugin concept; compose.ts spreads these into the flat assembly.
import { createBoardAgents } from "@backend/board/agents"
import { boardSkills } from "@backend/board/skills"
import {
  BoardAnalysisAssetReadTool,
  BoardAnalysisAssetUpsertTool,
  BoardAnalysisBundleReadTool,
  BoardAnalysisContextTool,
  BoardReportWriteTool,
  BoardSnapshotTool,
} from "@backend/board/tools"
import type { AnyToolDefinition } from "@harness"

export const boardTools: AnyToolDefinition[] = [
  BoardSnapshotTool,
  BoardAnalysisContextTool,
  BoardAnalysisBundleReadTool,
  BoardAnalysisAssetUpsertTool,
  BoardAnalysisAssetReadTool,
  BoardReportWriteTool,
]

export { boardSkills, createBoardAgents }

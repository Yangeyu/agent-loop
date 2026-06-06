import { boardSkills } from "@backend/board/skills"
import { boardAgents } from "@backend/board/agents"
import {
  BoardAnalysisAssetReadTool,
  BoardAnalysisAssetUpsertTool,
  BoardAnalysisBundleReadTool,
  BoardAnalysisContextTool,
  BoardReportWriteTool,
  BoardSnapshotTool,
} from "@backend/board/tools"
import type { RuntimePlugin } from "@harness"

export const boardPlugin: RuntimePlugin = {
  name: "board",
  agents: boardAgents,
  skills: boardSkills,
  tools: [
    BoardSnapshotTool,
    BoardAnalysisContextTool,
    BoardAnalysisBundleReadTool,
    BoardAnalysisAssetUpsertTool,
    BoardAnalysisAssetReadTool,
    BoardReportWriteTool,
  ],
}

export const boardModule = boardPlugin

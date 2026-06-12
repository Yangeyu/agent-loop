import { buildBoardAnalysisContext } from "@backend/board/shared/analyze"
import { loadBoardSnapshots } from "@backend/board/shared/snapshot"
import {
  createBoardAnalysisDataset,
  getBoardAnalysisDatasetJsonPath,
  summarizeBoardAnalysisDataset,
} from "@backend/board/shared/store"
import { defineTool } from "@harness"
import { z } from "zod"

export const BoardAnalysisContextParameters = z.object({
  boardIds: z.array(z.string().trim().min(1)).min(1),
  prompt: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  publicOnly: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(200).optional(),
})

export const BoardAnalysisContextTool = defineTool({
  id: "board_analysis_context",
  description: "Load, clean, and aggregate one or more boards into a stored analysis dataset, then return only the dataset summary and bundle catalog.",
  parameters: BoardAnalysisContextParameters,
  beforeExecute({ args }) {
    return {
      title: `board_analysis_context: ${args.boardIds.join(", ")}`,
      metadata: {
        boardIds: args.boardIds,
        userId: args.userId,
        publicOnly: args.publicOnly,
        limit: args.limit,
      },
    }
  },
  async execute(args, ctx) {
    const limit = args.limit ?? args.boardIds.length
    const boards = await loadBoardSnapshots({
      boardIds: args.boardIds,
      userId: args.userId,
      publicOnly: args.publicOnly,
      limit,
    })
    const analysis = buildBoardAnalysisContext({
      boards,
      prompt: args.prompt,
      filters: {
        boardIds: args.boardIds,
        userId: args.userId,
        publicOnly: args.publicOnly,
        limit,
      },
    })
    const dataset = createBoardAnalysisDataset({
      sessionId: ctx.sessionID,
      context: analysis,
    })
    const summary = summarizeBoardAnalysisDataset(dataset)
    const datasetPath = getBoardAnalysisDatasetJsonPath(summary.analysisId)

    return {
      title: `Board analysis context: ${boards.length} board(s)`,
      output: JSON.stringify(summary, null, 2),
      metadata: {
        analysisId: summary.analysisId,
        datasetPath,
        boardIds: args.boardIds,
        boardCount: summary.overview.boardCount,
        sectionCount: summary.overview.sectionCount,
        typeCounts: summary.overview.typeCounts,
      },
    }
  },
})

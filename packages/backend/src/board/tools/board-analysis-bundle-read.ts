import { readBoardAnalysisBundle } from "@backend/board/shared/store"
import { BoardAnalysisBundleTypeSchema } from "@backend/board/tools/types"
import { defineTool } from "@harness"
import { z } from "zod"

export const BoardAnalysisBundleReadParameters = z.object({
  analysisId: z.string().trim().min(1),
  bundleType: BoardAnalysisBundleTypeSchema,
})

export const BoardAnalysisBundleReadTool = defineTool({
  id: "board_analysis_bundle_read",
  description: "Read one stored board analysis bundle by analysisId and bundleType, returning only bundle-focused data.",
  parameters: BoardAnalysisBundleReadParameters,
  beforeExecute({ args }) {
    return {
      title: `board_analysis_bundle_read: ${args.bundleType}`,
      metadata: {
        analysisId: args.analysisId,
        bundleType: args.bundleType,
      },
    }
  },
  async execute(args, ctx) {
    const bundle = readBoardAnalysisBundle({
      store: ctx.session_store,
      analysisId: args.analysisId,
      bundleType: args.bundleType,
    })

    return {
      title: `Board analysis bundle: ${args.bundleType}`,
      output: JSON.stringify(bundle, null, 2),
      metadata: {
        analysisId: args.analysisId,
        bundleType: args.bundleType,
        itemCount: bundle.bundle.length,
      },
    }
  },
})

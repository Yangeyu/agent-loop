import { readBoardAnalysisAssets } from "@backend/board/shared/store"
import { BoardAnalysisAssetReadParameters } from "@backend/board/tools/types"
import { defineTool } from "@harness/tool/tool"

export const BoardAnalysisAssetReadTool = defineTool({
  id: "board_analysis_asset_read",
  description: "Read stored board analysis assets for one analysis dataset, including dataset summary and asset content.",
  parameters: BoardAnalysisAssetReadParameters,
  beforeExecute({ args }) {
    return {
      title: `board_analysis_asset_read: ${args.analysisId}`,
      metadata: {
        analysisId: args.analysisId,
        requestedNames: args.names,
      },
    }
  },
  async execute(args, ctx) {
    const result = readBoardAnalysisAssets({
      store: ctx.session_store,
      analysisId: args.analysisId,
      names: args.names,
    })

    return {
      title: `Board analysis assets: ${args.analysisId}`,
      output: JSON.stringify(result, null, 2),
      metadata: {
        analysisId: args.analysisId,
        assetCount: result.assets.length,
      },
    }
  },
})

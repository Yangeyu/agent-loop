import { upsertBoardAnalysisAsset } from "@backend/board/shared/store"
import { BoardAnalysisAssetWriteParameters } from "@backend/board/tools/types"
import { defineTool } from "@harness"

export const BoardAnalysisAssetUpsertTool = defineTool({
  id: "board_analysis_asset_upsert",
  description: "Create or update a stored board analysis asset for an analysis dataset without returning the full asset body.",
  parameters: BoardAnalysisAssetWriteParameters,
  beforeExecute({ args }) {
    return {
      title: `board_analysis_asset_upsert: ${args.name}`,
      metadata: {
        analysisId: args.analysisId,
        name: args.name,
        focus: args.focus,
        sourceBundleTypes: args.sourceBundleTypes,
      },
    }
  },
  async execute(args, ctx) {
    const asset = upsertBoardAnalysisAsset({
      analysisId: args.analysisId,
      name: args.name,
      content: args.content,
      focus: args.focus,
      sourceBundleTypes: args.sourceBundleTypes,
    })

    return {
      title: `Stored analysis asset: ${asset.name}`,
      output: [
        `Stored asset \"${asset.name}\" for analysis ${args.analysisId}.`,
        `Source bundles: ${asset.sourceBundleTypes.join(", ")}.`,
        args.focus ? `Focus: ${args.focus}.` : undefined,
      ].filter(Boolean).join("\n"),
      metadata: {
        analysisId: args.analysisId,
        name: asset.name,
        focus: asset.focus,
        sourceBundleTypes: asset.sourceBundleTypes,
        updatedAt: asset.updatedAt,
      },
    }
  },
})

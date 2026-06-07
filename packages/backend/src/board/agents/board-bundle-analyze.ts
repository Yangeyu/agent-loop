import { BOARD_BUNDLE_ANALYZE_PROMPT } from "@backend/board/prompts"
import { baseMiddleware, defineAgent } from "@harness"

export const boardBundleAnalyzeAgent = defineAgent({
  name: "board_bundle_analyze",
  description:
    "Analyzes exactly one board analysis bundle and stores one reusable asset back into the analysis dataset.",
  mode: "subagent",
  instructions: [BOARD_BUNDLE_ANALYZE_PROMPT],
  tools: {
    board_analysis_bundle_read: true,
    board_analysis_asset_upsert: true,
    board_snapshot: true,
  },
  steps: 4,
  middleware: baseMiddleware(),
})

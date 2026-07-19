import { BOARD_BUNDLE_ANALYZE_PROMPT } from "@backend/board/prompts"
import { baseMiddleware, defineAgent, type AgentDefinition, type Model } from "@harness"

export function createBoardBundleAnalyzeAgent(deps: { model: Model }): AgentDefinition {
  return defineAgent({
    name: "board_bundle_analyze",
    description:
      "Analyzes exactly one board analysis bundle and stores one reusable asset back into the analysis dataset.",
    mode: "subagent",
    model: deps.model,
    instructions: [BOARD_BUNDLE_ANALYZE_PROMPT],
    tools: {
      board_analysis_bundle_read: true,
      board_analysis_asset_upsert: true,
      board_snapshot: true,
    },
    steps: 4,
    middleware: baseMiddleware(),
  })
}

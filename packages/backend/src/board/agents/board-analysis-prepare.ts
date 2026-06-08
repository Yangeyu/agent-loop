import { BOARD_ANALYSIS_PREPARE_PROMPT } from "@backend/board/prompts"
import { baseMiddleware, createDashScopeModel, defineAgent } from "@harness"

export const boardAnalysisPrepareAgent = defineAgent({
  name: "board_analysis_prepare",
  description:
    "Loads board data, cleans and aggregates it into a stored analysis dataset, then returns the dataset summary for downstream analysis.",
  mode: "subagent",
  model: createDashScopeModel({ modelID: "qwen3.7-plus" }),
  instructions: [BOARD_ANALYSIS_PREPARE_PROMPT],
  tools: {
    board_analysis_context: true,
    board_snapshot: true,
  },
  steps: 3,
  middleware: baseMiddleware(),
})

import { BOARD_WRITE_PROMPT } from "@backend/board/prompts"
import { baseMiddleware, createDashScopeModel, defineAgent } from "@harness"

export const boardWriteAgent = defineAgent({
  name: "board_write",
  description:
    "Reads stored board analysis assets, writes the final board report under the current project data directory, and returns only the saved report reference.",
  mode: "subagent",
  model: createDashScopeModel({ modelID: "qwen3.7-plus" }),
  instructions: [BOARD_WRITE_PROMPT],
  tools: {
    board_analysis_asset_read: true,
    board_report_write: true,
    present_files: true,
  },
  steps: 4,
  middleware: baseMiddleware(),
})

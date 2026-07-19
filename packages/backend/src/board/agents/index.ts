import { createBoardAnalysisPrepareAgent } from "@backend/board/agents/board-analysis-prepare"
import { createBoardBundleAnalyzeAgent } from "@backend/board/agents/board-bundle-analyze"
import { createBoardWriteAgent } from "@backend/board/agents/board-write"
import type { AgentDefinition, Model } from "@harness"

/** Builds the board domain's delegated subagents on the injected chat model. */
export function createBoardAgents(deps: { model: Model }): AgentDefinition[] {
  return [createBoardAnalysisPrepareAgent(deps), createBoardBundleAnalyzeAgent(deps), createBoardWriteAgent(deps)]
}

export { createBoardAnalysisPrepareAgent, createBoardBundleAnalyzeAgent, createBoardWriteAgent }

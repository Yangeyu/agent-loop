import type { AgentDefinition } from "@harness"
import { boardAnalysisPrepareAgent } from "@backend/board/agents/board-analysis-prepare"
import { boardBundleAnalyzeAgent } from "@backend/board/agents/board-bundle-analyze"
import { boardWriteAgent } from "@backend/board/agents/board-write"

export const boardAgents: AgentDefinition[] = [boardAnalysisPrepareAgent, boardBundleAnalyzeAgent, boardWriteAgent]

export { boardAnalysisPrepareAgent }
export { boardBundleAnalyzeAgent }
export { boardWriteAgent }

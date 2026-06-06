import type { AgentInfo } from "@harness/types"
import { boardAnalysisPrepareAgent } from "@backend/board/agents/board-analysis-prepare"
import { boardBundleAnalyzeAgent } from "@backend/board/agents/board-bundle-analyze"
import { boardWriteAgent } from "@backend/board/agents/board-write"

export const boardAgents: AgentInfo[] = [boardAnalysisPrepareAgent, boardBundleAnalyzeAgent, boardWriteAgent]

export { boardAnalysisPrepareAgent }
export { boardBundleAnalyzeAgent }
export { boardWriteAgent }

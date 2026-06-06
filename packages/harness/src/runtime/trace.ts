import type { RuntimeEvent, RuntimeEventBus } from "@harness/runtime/events"
import type { TurnOutcomeReason } from "@harness/types"

export type ToolCallTrace = {
  tool: string
  args?: unknown
  status: "pending" | "completed" | "error"
  output?: string
  error?: string
}

export type RetryTrace = {
  attempt: number
  delayMs: number
  category: "abort" | "timeout" | "network" | "availability" | "rate_limit" | "unknown"
  reason?: string
  error: string
}

export type BudgetHitTrace = {
  budget: "session_steps" | "agent_steps" | "subagent_depth" | "tool_calls" | "tool_failures"
  detail: string
  limit: number
  used?: number
}

export type TurnTrace = {
  sessionID: string
  agent: string
  messageID: string
  turnID: string
  step: number
  system?: string[]
  tools?: string[]
  messageCount?: number
  toolCalls: ToolCallTrace[]
  retries: RetryTrace[]
  budgetHits: BudgetHitTrace[]
  outcome?: {
    kind: "continue" | "compact" | "break"
    reason: TurnOutcomeReason
  }
  finishReason?: string
  durationMs?: number
  aborted?: boolean
  error?: string
}

export type RuntimeTrace = {
  turns(): TurnTrace[]
  turnsForSession(sessionID: string): TurnTrace[]
}

export function createRuntimeTrace(events: RuntimeEventBus): RuntimeTrace {
  const turns = new Map<string, TurnTrace>()
  const order: string[] = []
  const activeBySessionAgent = new Map<string, string>()

  events.subscribe((event) => {
    if (event.type === "turn-start") {
      const key = toTurnKey(event.sessionID, event.turnID)
      if (!turns.has(key)) {
        turns.set(key, {
          sessionID: event.sessionID,
          agent: event.agent,
          messageID: event.messageID,
          turnID: event.turnID,
          step: event.step,
          toolCalls: [],
          retries: [],
          budgetHits: [],
        })
        order.push(key)
      }
      activeBySessionAgent.set(toSessionAgentKey(event.sessionID, event.agent), key)
      return
    }

    if (event.type === "turn-input") {
      const turn = getOrCreateTurn(turns, order, event.sessionID, event.agent, event.messageID, event.turnID, event.step)
      turn.system = [...event.system]
      turn.tools = [...event.tools]
      turn.messageCount = event.messageCount
      return
    }

    if (event.type === "tool-call") {
      const turn = getActiveTurn(turns, activeBySessionAgent, event.sessionID, event.agent)
      if (!turn) return
      turn.toolCalls.push({
        tool: event.tool,
        args: event.args,
        status: "pending",
      })
      return
    }

    if (event.type === "tool-result") {
      const turn = getActiveTurn(turns, activeBySessionAgent, event.sessionID, event.agent)
      if (!turn) return
      const call = findLastPendingToolCall(turn, event.tool)
      if (call) {
        call.status = "completed"
        call.output = event.output
        return
      }
      turn.toolCalls.push({ tool: event.tool, status: "completed", output: event.output })
      return
    }

    if (event.type === "tool-error") {
      const turn = getActiveTurn(turns, activeBySessionAgent, event.sessionID, event.agent)
      if (!turn) return
      const call = findLastPendingToolCall(turn, event.tool)
      if (call) {
        call.status = "error"
        call.error = event.error
        return
      }
      turn.toolCalls.push({ tool: event.tool, status: "error", error: event.error })
      return
    }

    if (event.type === "retry") {
      const turn = getOrCreateTurn(turns, order, event.sessionID, event.agent, event.messageID, event.turnID)
      turn.retries.push({
        attempt: event.attempt,
        delayMs: event.delayMs,
        category: event.category,
        reason: event.reason,
        error: event.error,
      })
      return
    }

    if (event.type === "budget-hit") {
      const turn = getActiveTurn(turns, activeBySessionAgent, event.sessionID, event.agent)
      if (!turn) return
      turn.budgetHits.push({
        budget: event.budget,
        detail: event.detail,
        limit: event.limit,
        used: event.used,
      })
      return
    }

    if (event.type === "turn-outcome") {
      const turn = getOrCreateTurn(turns, order, event.sessionID, event.agent, event.messageID, event.turnID, event.step)
      turn.outcome = {
        kind: event.outcome,
        reason: event.reason,
      }
      return
    }

    if (event.type === "finish") {
      const turn = getActiveTurn(turns, activeBySessionAgent, event.sessionID, event.agent)
      if (!turn) return
      turn.finishReason = event.finishReason
      return
    }

    if (event.type === "turn-complete") {
      const turn = getOrCreateTurn(turns, order, event.sessionID, event.agent, event.messageID, event.turnID)
      turn.finishReason = event.finishReason
      turn.durationMs = event.durationMs
      activeBySessionAgent.delete(toSessionAgentKey(event.sessionID, event.agent))
      return
    }

    if (event.type === "turn-abort") {
      const turn = getOrCreateTurn(turns, order, event.sessionID, event.agent, event.messageID, event.turnID)
      turn.aborted = true
      turn.durationMs = event.durationMs
      activeBySessionAgent.delete(toSessionAgentKey(event.sessionID, event.agent))
      return
    }

    if (event.type === "error") {
      const turn = getActiveTurn(turns, activeBySessionAgent, event.sessionID, event.agent)
      if (!turn) return
      turn.error = event.error
    }
  })

  return {
    turns() {
      return order
        .map((key) => turns.get(key))
        .filter((turn): turn is TurnTrace => Boolean(turn))
        .map(cloneTurnTrace)
    },
    turnsForSession(sessionID: string) {
      return order
        .map((key) => turns.get(key))
        .filter((turn): turn is TurnTrace => Boolean(turn))
        .filter((turn) => turn.sessionID === sessionID)
        .map(cloneTurnTrace)
    },
  }
}

function toTurnKey(sessionID: string, turnID: string) {
  return `${sessionID}:${turnID}`
}

function toSessionAgentKey(sessionID: string, agent: string) {
  return `${sessionID}:${agent}`
}

function getActiveTurn(
  turns: Map<string, TurnTrace>,
  activeBySessionAgent: Map<string, string>,
  sessionID: string,
  agent: string,
) {
  const key = activeBySessionAgent.get(toSessionAgentKey(sessionID, agent))
  if (!key) return undefined
  return turns.get(key)
}

function getOrCreateTurn(
  turns: Map<string, TurnTrace>,
  order: string[],
  sessionID: string,
  agent: string,
  messageID: string,
  turnID: string,
  step?: number,
) {
  const key = toTurnKey(sessionID, turnID)
  const existing = turns.get(key)
  if (existing) {
    if (step !== undefined) existing.step = step
    return existing
  }

  const created: TurnTrace = {
    sessionID,
    agent,
    messageID,
    turnID,
    step: step ?? 0,
    toolCalls: [],
    retries: [],
    budgetHits: [],
  }
  turns.set(key, created)
  order.push(key)
  return created
}

function findLastPendingToolCall(turn: TurnTrace, tool: string) {
  for (let index = turn.toolCalls.length - 1; index >= 0; index -= 1) {
    const call = turn.toolCalls[index]
    if (call.tool === tool && call.status === "pending") return call
  }

  return undefined
}

function cloneTurnTrace(turn: TurnTrace): TurnTrace {
  return {
    ...turn,
    system: turn.system ? [...turn.system] : undefined,
    tools: turn.tools ? [...turn.tools] : undefined,
    toolCalls: turn.toolCalls.map((call) => ({ ...call })),
    retries: turn.retries.map((retry) => ({ ...retry })),
    budgetHits: turn.budgetHits.map((budgetHit) => ({ ...budgetHit })),
    outcome: turn.outcome ? { ...turn.outcome } : undefined,
  }
}

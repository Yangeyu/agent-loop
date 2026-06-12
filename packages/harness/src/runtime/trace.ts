// RuntimeTrace: an in-memory debugging projection of the loop, keyed by turn
// (assistant message id). Loop telemetry fills the turn skeleton; tool activity
// is folded from the state channel's tool parts, with partID as the join key —
// no heuristic "last pending call" matching.
import type { RuntimeEventBus } from "@harness/runtime/events"
import type { BudgetKind, RetryCategory, ToolPart, TurnOutcomeReason } from "@harness/types"

export type ToolCallTrace = {
  tool: string
  args?: unknown
  status: "running" | "completed" | "error"
  output?: string
  error?: string
}

export type RetryTrace = {
  attempt: number
  delayMs: number
  category: RetryCategory
  reason?: string
  error: string
}

export type BudgetHitTrace = {
  budget: BudgetKind
  detail: string
  limit: number
  used?: number
}

export type TurnTrace = {
  sessionID: string
  agent: string
  messageID: string
  step: number
  system?: string[]
  tools?: string[]
  messageCount?: number
  toolCalls: ToolCallTrace[]
  retries: RetryTrace[]
  budgetHits: BudgetHitTrace[]
  outcome?: {
    kind: "continue" | "break"
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
  // partID -> its tool trace entry; partID -> owning turn resolves via messageID.
  const toolTraces = new Map<string, ToolCallTrace>()
  // budget.hit carries no messageID; attribute it to the session's latest turn.
  const lastTurnBySession = new Map<string, string>()

  const getTurn = (messageID: string) => turns.get(messageID)

  events.loop.subscribe((event) => {
    if (event.type === "turn.start") {
      turns.set(event.messageID, {
        sessionID: event.sessionID,
        agent: event.agent,
        messageID: event.messageID,
        step: event.step,
        toolCalls: [],
        retries: [],
        budgetHits: [],
      })
      order.push(event.messageID)
      lastTurnBySession.set(event.sessionID, event.messageID)
      return
    }

    if (event.type === "turn.input") {
      const turn = getTurn(event.messageID)
      if (!turn) return
      turn.system = [...event.system]
      turn.tools = [...event.tools]
      turn.messageCount = event.messageCount
      return
    }

    if (event.type === "turn.retry") {
      getTurn(event.messageID)?.retries.push({
        attempt: event.attempt,
        delayMs: event.delayMs,
        category: event.category,
        reason: event.reason,
        error: event.error,
      })
      return
    }

    if (event.type === "budget.hit") {
      const messageID = lastTurnBySession.get(event.sessionID)
      const turn = messageID ? getTurn(messageID) : undefined
      turn?.budgetHits.push({
        budget: event.budget,
        detail: event.detail,
        limit: event.limit,
        used: event.used,
      })
      return
    }

    if (event.type === "turn.outcome") {
      const turn = getTurn(event.messageID)
      if (!turn) return
      turn.outcome = { kind: event.outcome, reason: event.reason }
      return
    }

    if (event.type === "turn.end") {
      const turn = getTurn(event.messageID)
      if (!turn) return
      turn.durationMs = event.durationMs
      if (event.reason === "abort") turn.aborted = true
      if (event.reason === "error") turn.error = event.error
      if (event.finishReason) turn.finishReason = event.finishReason
    }
  })

  events.state.subscribe((event) => {
    if (event.type === "part.created" && event.part.type === "tool") {
      const turn = getTurn(event.messageID)
      if (!turn) return
      const trace: ToolCallTrace = {
        tool: event.part.toolName,
        args: event.part.state.input,
        status: "running",
      }
      toolTraces.set(event.part.id, trace)
      turn.toolCalls.push(trace)
      return
    }

    if (event.type === "part.updated" && event.part.type === "tool") {
      const trace = toolTraces.get(event.part.id)
      if (!trace) return
      applyToolState(trace, event.part)
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

function applyToolState(trace: ToolCallTrace, part: ToolPart) {
  trace.args = part.state.input
  if (part.state.status === "completed") {
    trace.status = "completed"
    trace.output = part.state.output
    return
  }
  if (part.state.status === "error") {
    trace.status = "error"
    trace.error = part.state.error.message
    return
  }
  trace.status = "running"
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

/**
 * Pure resolution of retry/timeout/budget numbers from config + agent + session.
 * Budgets are *resolved* here but *enforced* by the budget middleware.
 */
import type { Config } from "@harness/config"
import type { AgentDefinition } from "@harness/agent/blueprint"
import type { Sessions } from "@harness/session"
import type { SessionInfo } from "@harness/types"

/** Retry backoff bounds for a single turn's model call. */
export type RetryPolicy = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

/** Per-turn timeout bound. */
export type TimeoutPolicy = {
  turnTimeoutMs: number
}

/**
 * Resolved step/tool/depth budgets for a turn (enforced by budget middleware).
 *
 * The step caps are deliberately kept as two independent numbers rather than
 * one combined limit: `maxAgentSteps` bounds the current run (compared against
 * a step counter that climbs from 1), while the session numbers bound the
 * session across all of its runs. Collapsing them with a `min()` would compare
 * a climbing counter against a shrinking remainder, and the two would meet
 * halfway — capping every run at half the session budget.
 */
export type TurnBudgetPolicy = {
  maxAgentSteps: number
  // Scoped to the whole run, not one turn: the budget middleware is built once
  // per run, so its tool-call counter accumulates across every turn in the loop.
  maxRunToolCalls: number
  maxSessionSteps: number
  sessionStepsUsed: number
  sessionStepsRemaining: number
  maxSubagentDepth: number
}

/** The full set of execution bounds for a turn: retry + timeout + budget. */
export type TurnExecutionPolicy = {
  retry: RetryPolicy
  timeout: TimeoutPolicy
  // Max tool calls executed in parallel within one turn's fan-out. Resolved per
  // turn (not a shared semaphore), so a parent turn delegating to subagents that
  // themselves fan out cannot deadlock on one global counter.
  toolConcurrency: number
  budget: TurnBudgetPolicy
}

/**
 * Resolves the turn execution policy from config, the agent blueprint, and the
 * current session (used to compute remaining session-step budget).
 *
 * @param config - the runtime config
 * @param agent - the agent blueprint (its per-agent step cap)
 * @param session - the current session (to count steps already used)
 * @returns the resolved retry/timeout/budget policy
 */
export function resolveTurnExecutionPolicy(config: Config, agent: AgentDefinition, session: SessionInfo): TurnExecutionPolicy {
  const maxAgentSteps = agent.steps ?? Number.POSITIVE_INFINITY
  const sessionStepsUsed = countAssistantTurns(session)
  const sessionStepsRemaining = Math.max(0, config.session_max_steps - sessionStepsUsed)

  return {
    retry: {
      maxRetries: config.model_max_retries,
      baseDelayMs: config.model_retry_base_delay_ms,
      maxDelayMs: config.model_retry_max_delay_ms,
    },
    timeout: {
      turnTimeoutMs: config.turn_timeout_ms,
    },
    toolConcurrency: config.tool_max_concurrency,
    budget: {
      maxAgentSteps,
      maxRunToolCalls: agent.maxToolCalls ?? config.run_max_tool_calls,
      maxSessionSteps: config.session_max_steps,
      sessionStepsUsed,
      sessionStepsRemaining,
      maxSubagentDepth: config.subagent_max_depth,
    },
  }
}

/**
 * Whether the given step is the last one this run may take — because the agent's
 * own step cap is reached, or because the session has one step left to spend.
 *
 * Shared by the budget middleware (which stops here) and context assembly
 * (which warns the model here), so the warning and the stop cannot drift apart.
 *
 * @param budget - the resolved budgets for this turn
 * @param step - the current 1-based step within the run
 * @returns true when no further step is allowed after this one
 */
export function isFinalAllowedStep(budget: TurnBudgetPolicy, step: number) {
  return step >= budget.maxAgentSteps || budget.sessionStepsRemaining <= 1
}

/**
 * Counts assistant turns in a session (≈ steps used).
 *
 * @param session - the session to count
 * @returns the number of assistant messages
 */
function countAssistantTurns(session: SessionInfo) {
  return session.messages.filter((message) => message.role === "assistant").length
}

/**
 * Walks the parent chain to compute a session's delegation depth.
 *
 * @param sessions - the session aggregate, to resolve parent sessions
 * @param sessionID - the session whose depth to measure
 * @returns the depth (0 for a root session)
 */
export function resolveSessionDepth(sessions: Sessions, sessionID: string) {
  let depth = 0
  let current = sessions.get(sessionID)

  while (current.parentID) {
    depth += 1
    current = sessions.get(current.parentID)
  }

  return depth
}

/**
 * Computes whether delegating one level deeper from a session is within the depth
 * cap, returning the current/next depth alongside the verdict.
 *
 * @param input - the session aggregate, the session id, and the max allowed depth
 * @returns current/next depth, the cap, and whether delegation is allowed
 */
export function getDelegationDepthInfo(input: {
  sessions: Sessions
  sessionID: string
  maxDepth: number
}) {
  const currentDepth = resolveSessionDepth(input.sessions, input.sessionID)
  const nextDepth = currentDepth + 1

  return {
    currentDepth,
    nextDepth,
    maxDepth: input.maxDepth,
    allowed: nextDepth <= input.maxDepth,
  }
}

/**
 * Derives a turn-scoped abort signal that fires on the parent's abort or after the
 * timeout, whichever comes first. Returns a `dispose` to clear the timer and
 * detach the parent listener (call it in a finally).
 *
 * @param input - the optional parent signal and the turn timeout in ms (≤0/∞ = none)
 * @returns the derived `signal` and a `dispose` cleanup
 */
export function createTurnAbortSignal(input: { parent?: AbortSignal; timeoutMs: number }) {
  const parent = input.parent
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    return {
      signal: parent ?? new AbortController().signal,
      dispose() {},
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Turn timed out after ${input.timeoutMs}ms`))
  }, input.timeoutMs)

  const onAbort = () => {
    controller.abort(parent?.reason ?? new DOMException("Aborted", "AbortError"))
  }

  if (parent) {
    if (parent.aborted) {
      onAbort()
    } else {
      parent.addEventListener("abort", onAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout)
      if (parent) {
        parent.removeEventListener("abort", onAbort)
      }
    },
  }
}

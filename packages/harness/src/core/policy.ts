/**
 * Pure resolution of retry/timeout/budget numbers from config + agent + session.
 * Budgets are *resolved* here but *enforced* by the budget middleware.
 */
import type { Config } from "@harness/config"
import type { AgentDefinition } from "@harness/agent/types"
import type { ISessionStore } from "@harness/session/store"
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

/** Resolved step/tool/depth budgets for a turn (enforced by budget middleware). */
export type TurnBudgetPolicy = {
  maxSteps: number
  maxAgentSteps: number
  maxToolCalls: number
  repeatedToolFailureThreshold: number
  maxSessionSteps: number
  sessionStepsUsed: number
  sessionStepsRemaining: number
  maxSubagentDepth: number
}

/** The full set of execution bounds for a turn: retry + timeout + budget. */
export type TurnExecutionPolicy = {
  retry: RetryPolicy
  timeout: TimeoutPolicy
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
    budget: {
      maxSteps: Math.min(maxAgentSteps, sessionStepsRemaining),
      maxAgentSteps,
      maxToolCalls: config.turn_max_tool_calls,
      repeatedToolFailureThreshold: config.repeated_tool_failure_threshold,
      maxSessionSteps: config.session_max_steps,
      sessionStepsUsed,
      sessionStepsRemaining,
      maxSubagentDepth: config.subagent_max_depth,
    },
  }
}

/**
 * Counts assistant turns in a session (≈ steps used).
 *
 * @param session - the session to count
 * @returns the number of assistant messages
 */
export function countAssistantTurns(session: SessionInfo) {
  return session.messages.filter((message) => message.role === "assistant").length
}

/**
 * Walks the parent chain to compute a session's delegation depth.
 *
 * @param store - the session store, to resolve parent sessions
 * @param sessionID - the session whose depth to measure
 * @returns the depth (0 for a root session)
 */
export function resolveSessionDepth(store: ISessionStore, sessionID: string) {
  let depth = 0
  let current = store.get(sessionID)

  while (current.parentID) {
    depth += 1
    current = store.get(current.parentID)
  }

  return depth
}

/**
 * Computes whether delegating one level deeper from a session is within the depth
 * cap, returning the current/next depth alongside the verdict.
 *
 * @param input - the store, the session id, and the max allowed depth
 * @returns current/next depth, the cap, and whether delegation is allowed
 */
export function getDelegationDepthInfo(input: {
  store: ISessionStore
  sessionID: string
  maxDepth: number
}) {
  const currentDepth = resolveSessionDepth(input.store, input.sessionID)
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

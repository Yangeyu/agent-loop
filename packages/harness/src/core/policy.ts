// Pure resolution of retry/timeout/budget numbers from config + agent + session.
// Budgets are *resolved* here but *enforced* by the budget middleware.
import type { Config } from "@harness/config"
import type { AgentDefinition } from "@harness/agent/types"
import type { ISessionStore } from "@harness/session/store"
import type { SessionInfo } from "@harness/types"

export type RetryPolicy = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

export type TimeoutPolicy = {
  turnTimeoutMs: number
}

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

export type TurnExecutionPolicy = {
  retry: RetryPolicy
  timeout: TimeoutPolicy
  budget: TurnBudgetPolicy
}

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

export function countAssistantTurns(session: SessionInfo) {
  return session.messages.filter((message) => message.role === "assistant").length
}

export function resolveSessionDepth(store: ISessionStore, sessionID: string) {
  let depth = 0
  let current = store.get(sessionID)

  while (current.parentID) {
    depth += 1
    current = store.get(current.parentID)
  }

  return depth
}

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

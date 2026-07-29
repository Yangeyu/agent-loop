/**
 * Pure resolution of timeout/budget numbers from config + agent + session.
 * Budgets are *resolved* here but *enforced* by the budget middleware.
 */
import type { CoreConfig } from "@agent-core/config"
import type { AgentDefinition } from "@agent-core/blueprint"
import type { SessionInfo } from "@agent-core/types"

/** Per-step timeout bound. */
export type TimeoutPolicy = {
  stepTimeoutMs: number
}

/**
 * Resolved step/tool/depth budgets for a step (enforced by budget middleware).
 *
 * The step caps are two independent numbers: `maxAgentSteps` bounds the
 * current run against a counter climbing from 1, while the session numbers
 * bound the session across all of its runs — a climbing counter and a
 * shrinking remainder cannot share one combined limit.
 */
export type StepBudgetPolicy = {
  maxAgentSteps: number
  /** Scoped to the whole run: the tool-call counter accumulates across every step. */
  maxRunToolCalls: number
  maxSessionSteps: number
  sessionStepsUsed: number
  sessionStepsRemaining: number
}

/** The full set of execution bounds for a step: timeout + budget. */
export type StepExecutionPolicy = {
  timeout: TimeoutPolicy
  /**
   * Max tool calls in flight within one step's fan-out. Resolved per step, so
   * a parent step and its delegated subagents never contend on one counter.
   */
  toolConcurrency: number
  budget: StepBudgetPolicy
}

/**
 * Resolves the step execution policy from config, the agent blueprint, and the
 * current session (used to compute remaining session-step budget).
 *
 * @param config - the runtime config
 * @param agent - the agent blueprint (its per-agent step cap)
 * @param session - the current session (to count steps already used)
 * @returns the resolved timeout/budget policy
 */
export function resolveStepExecutionPolicy(config: CoreConfig, agent: AgentDefinition, session: SessionInfo): StepExecutionPolicy {
  const maxAgentSteps = agent.steps ?? Number.POSITIVE_INFINITY
  const sessionStepsUsed = countAssistantSteps(session)
  const sessionStepsRemaining = Math.max(0, config.session_max_steps - sessionStepsUsed)

  return {
    timeout: {
      stepTimeoutMs: config.step_timeout_ms,
    },
    toolConcurrency: config.tool_max_concurrency,
    budget: {
      maxAgentSteps,
      maxRunToolCalls: agent.maxToolCalls ?? config.run_max_tool_calls,
      maxSessionSteps: config.session_max_steps,
      sessionStepsUsed,
      sessionStepsRemaining,
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
 * @param budget - the resolved budgets for this step
 * @param step - the current 1-based step within the run
 * @returns true when no further step is allowed after this one
 */
export function isFinalAllowedStep(budget: StepBudgetPolicy, step: number) {
  return step >= budget.maxAgentSteps || budget.sessionStepsRemaining <= 1
}

/**
 * Counts assistant steps in a session (≈ steps used).
 *
 * @param session - the session to count
 * @returns the number of assistant messages
 */
function countAssistantSteps(session: SessionInfo) {
  return session.messages.filter((message) => message.role === "assistant").length
}

/**
 * Derives a step-scoped abort signal that fires on the parent's abort or after the
 * timeout, whichever comes first. Returns a `dispose` to clear the timer and
 * detach the parent listener (call it in a finally).
 *
 * @param input - the optional parent signal and the step timeout in ms (≤0/∞ = none)
 * @returns the derived `signal` and a `dispose` cleanup
 */
export function createStepAbortSignal(input: { parent?: AbortSignal; timeoutMs: number }) {
  const parent = input.parent
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    return {
      signal: parent ?? new AbortController().signal,
      dispose() {},
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Step timed out after ${input.timeoutMs}ms`))
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

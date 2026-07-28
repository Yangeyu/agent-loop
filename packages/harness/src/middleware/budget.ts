/**
 * The step/tool budget, both halves of it: the middleware that stops a run when
 * a budget breaks, and the prompt fragment that warns the model it is about to.
 * They ship together because they read the same predicate — a warning that could
 * drift from the stop it warns about is worse than no warning.
 */
import { isFinalAllowedStep, type TurnBudgetPolicy } from "@agent-core"
import type { MiddlewareFactory } from "@agent-core"
import type { PromptContributor } from "@harness/prompt"

/**
 * Prompt axis: tells the model where it is in its step budget.
 *
 * This is the only fragment that changes between steps, which is why the slot
 * vocabulary exists — it renders last, leaving everything above it stable.
 */
export const stepGuidance: PromptContributor = (ctx) => {
  if (isFinalAllowedStep(ctx.policy.budget, ctx.step)) {
    return {
      slot: "volatile",
      text: "This is your final allowed step. Conclude decisively and avoid leaving work unfinished.",
    }
  }
  if (ctx.step > 1) {
    return { slot: "volatile", text: "Continue the existing task and use any new context to make concrete progress." }
  }
  return undefined
}

/** Execution axis: enforces the step, session-step and tool-call budgets. */
export const budget: MiddlewareFactory = () => {
  let toolCalls = 0

  return {
    name: "budget",

    beforeTurn(ctx) {
      if (ctx.policy.budget.sessionStepsRemaining <= 0) {
        return {
          proceed: false,
          reason: "step_budget_reached",
          note: "\n\n[Stopped: total session step budget reached]",
        }
      }
      if (ctx.policy.budget.maxAgentSteps <= 0) {
        return {
          proceed: false,
          reason: "step_budget_reached",
          note: "\n\n[Stopped: agent step budget reached]",
        }
      }
      return { proceed: true }
    },

    beforeToolCall(ctx) {
      toolCalls += 1
      if (toolCalls > ctx.policy.budget.maxRunToolCalls) {
        return {
          action: "deny",
          error: {
            message: `Tool call budget exceeded for this run (${ctx.policy.budget.maxRunToolCalls})`,
            retryable: false,
            code: "tool_budget_exceeded",
          },
          note: "\n\n[Stopped: tool call budget exceeded]",
        }
      }
      return { action: "proceed" }
    },

    afterTurn(ctx, judgment) {
      const outcome = judgment.outcome
      if (outcome.kind !== "continue") return judgment
      if (!isFinalAllowedStep(ctx.policy.budget, ctx.step)) return judgment

      // Record the forced stop on the terminal (the engine applies it) instead
      // of writing the message directly.
      const terminal = judgment.terminal?.ok ? { ...judgment.terminal, finishReason: "stop" as const } : judgment.terminal

      const stopReason = resolveStepBudgetStopReason(ctx.policy.budget)
      if (outcome.reason === "empty_assistant") {
        return {
          ...judgment,
          terminal,
          outcome: {
            kind: "break",
            reason: "step_budget_reached_without_answer",
            note: `\n\n[Stopped: model ended without a final answer before ${stopReason}]`,
          },
        }
      }
      return {
        ...judgment,
        terminal,
        outcome: { kind: "break", reason: "step_budget_reached", note: `\n\n[Stopped: ${stopReason}]` },
      }
    },
  }
}

function resolveStepBudgetStopReason(budget: TurnBudgetPolicy) {
  if (budget.sessionStepsRemaining <= 1) return "total session step budget reached"
  return "max steps reached"
}

// Enforces step, session-step and tool-call budgets. Holds the per-loop tool
// call counter in closure and shapes the stop notes when a budget breaks.
import { isFinalAllowedStep, type TurnBudgetPolicy } from "@harness/agent/policy"
import type { MiddlewareFactory, TurnOutcome } from "@harness/agent/hooks"

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

    judgeTurn(ctx, judgment) {
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

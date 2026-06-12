// Enforces step, session-step and tool-call budgets. Holds the per-loop tool
// call counter in closure. Emits budget-hit events and shapes stop notes.
import type { TurnExecutionPolicy } from "@harness/core/policy"
import type { HookContext, MiddlewareFactory, TurnOutcome } from "@harness/hooks/types"

export const budget: MiddlewareFactory = () => {
  let toolCalls = 0

  return {
    name: "budget",

    beforeTurn(ctx) {
      if (ctx.policy.budget.maxSteps <= 0) {
        ctx.events.loop.emit({
          type: "budget.hit",
          sessionID: ctx.sessionID,
          rootID: ctx.rootID,
          agent: ctx.agent.name,
          budget: "session_steps",
          detail: "Total session step budget reached",
          limit: ctx.policy.budget.maxSessionSteps,
          used: ctx.policy.budget.sessionStepsUsed,
        })
        return {
          proceed: false,
          reason: "step_budget_reached",
          note: "\n\n[Stopped: total session step budget reached]",
        }
      }
      return { proceed: true }
    },

    beforeToolCall(ctx) {
      toolCalls += 1
      if (toolCalls > ctx.policy.budget.maxToolCalls) {
        ctx.events.loop.emit({
          type: "budget.hit",
          sessionID: ctx.sessionID,
          rootID: ctx.rootID,
          agent: ctx.agent.name,
          budget: "tool_calls",
          detail: "Tool call budget exceeded for turn",
          limit: ctx.policy.budget.maxToolCalls,
          used: toolCalls,
        })
        return {
          action: "deny",
          error: {
            message: `Tool call budget exceeded for turn (${ctx.policy.budget.maxToolCalls})`,
            retryable: false,
            code: "tool_budget_exceeded",
          },
          note: "\n\n[Stopped: tool call budget exceeded]",
        }
      }
      return { action: "proceed" }
    },

    resolveOutcome(ctx, outcome): TurnOutcome {
      if (outcome.kind !== "continue") return outcome
      if (ctx.step < ctx.policy.budget.maxSteps) return outcome

      emitStepBudgetHit(ctx)
      ctx.sessions.updateMessage(ctx.sessionID, ctx.messageID, { finish: "stop" })

      const stopReason = resolveStepBudgetStopReason(ctx.policy)
      if (outcome.reason === "empty_assistant") {
        return {
          kind: "break",
          reason: "step_budget_reached_without_answer",
          note: `\n\n[Stopped: model ended without a final answer before ${stopReason}]`,
        }
      }
      return { kind: "break", reason: "step_budget_reached", note: `\n\n[Stopped: ${stopReason}]` }
    },
  }
}

function emitStepBudgetHit(ctx: HookContext) {
  const event = resolveStepBudgetEvent(ctx.policy)
  ctx.events.loop.emit({
    type: "budget.hit",
    sessionID: ctx.sessionID,
    rootID: ctx.rootID,
    agent: ctx.agent.name,
    budget: event.kind,
    detail: event.detail,
    limit: event.limit,
    used: event.used,
  })
}

function resolveStepBudgetEvent(policy: TurnExecutionPolicy) {
  if (policy.budget.sessionStepsRemaining <= policy.budget.maxAgentSteps) {
    return {
      kind: "session_steps" as const,
      detail: "Total session step budget reached",
      limit: policy.budget.maxSessionSteps,
      used: policy.budget.sessionStepsUsed + policy.budget.maxSteps,
    }
  }

  return {
    kind: "agent_steps" as const,
    detail: "Agent step budget reached for this prompt loop",
    limit: policy.budget.maxAgentSteps,
    used: policy.budget.maxSteps,
  }
}

function resolveStepBudgetStopReason(policy: TurnExecutionPolicy) {
  if (policy.budget.sessionStepsRemaining <= policy.budget.maxAgentSteps) {
    return "total session step budget reached"
  }
  return "max steps reached"
}

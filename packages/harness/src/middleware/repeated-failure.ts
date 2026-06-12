// Stops the turn when the same tool keeps failing identically. Holds the
// per-loop failure history in closure; resets on any successful tool call.
import type { MiddlewareFactory } from "@harness/hooks/types"

export const repeatedFailure: MiddlewareFactory = () => {
  let failures: Array<{ toolName: string; input: unknown; error: string }> = []

  return {
    name: "repeated-failure",

    afterToolCall(_ctx, _call, result) {
      failures = []
      return result
    },

    onToolError(ctx, call, error) {
      failures.push({ toolName: call.toolName, input: call.args, error: error.message })

      const threshold = ctx.policy.budget.repeatedToolFailureThreshold
      const recent = failures.slice(-threshold)
      if (recent.length < threshold) return { action: "continue" }

      const [first, ...rest] = recent
      const signature = JSON.stringify(first)
      if (!rest.every((failure) => JSON.stringify(failure) === signature)) return { action: "continue" }

      ctx.events.loop.emit({
        type: "budget.hit",
        sessionID: ctx.sessionID,
        rootID: ctx.rootID,
        agent: ctx.agent.name,
        budget: "tool_failures",
        detail: `Repeated identical tool failures detected for ${call.toolName}`,
        limit: threshold,
        used: threshold,
      })

      return {
        action: "stop",
        error: {
          message: `Repeated identical tool failures detected for ${call.toolName}`,
          retryable: false,
          code: "repeated_tool_failure",
        },
        note: "\n\n[Stopped: repeated identical tool failures detected]",
      }
    },
  }
}

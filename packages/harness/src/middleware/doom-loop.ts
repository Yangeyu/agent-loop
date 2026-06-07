// Detects repeated identical tool calls within a run and stops the turn.
// Holds the per-loop call history in closure.
import type { MiddlewareFactory } from "@harness/hooks/types"
import { isDoomLoop } from "@harness/session/retry"

export const doomLoop: MiddlewareFactory = () => {
  const history: Array<{ toolName: string; args: unknown }> = []

  return {
    name: "doom-loop",
    beforeToolCall(_ctx, call) {
      if (isDoomLoop(history, call.toolName, call.args)) {
        return {
          action: "deny",
          error: {
            message: `Potential doom loop detected for tool ${call.toolName}`,
            retryable: false,
            code: "doom_loop",
          },
          note: "\n\n[Stopped: repeated identical tool calls detected]",
        }
      }
      history.push({ toolName: call.toolName, args: call.args })
      return { action: "proceed" }
    },
  }
}

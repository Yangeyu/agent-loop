// Detects repeated identical tool calls within a run and stops the turn.
// Holds the per-loop call history in closure; the detection rule lives here
// since this middleware is its only consumer.
import type { MiddlewareFactory } from "@harness/hooks/types"

const DOOM_LOOP_THRESHOLD = 3

function isDoomLoop(
  history: Array<{ toolName: string; args: unknown }>,
  toolName: string,
  args: unknown,
): boolean {
  const recent = history.slice(-(DOOM_LOOP_THRESHOLD - 1))
  return (
    recent.length === DOOM_LOOP_THRESHOLD - 1 &&
    recent.every(
      (item) => item.toolName === toolName && JSON.stringify(item.args) === JSON.stringify(args),
    )
  )
}

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

/**
 * Base turn-outcome resolution: continue vs break, derived purely from the
 * assistant message state and whether tool calls were seen. Policy-driven
 * overrides (step budget, structured output) are applied by middleware via
 * the resolveOutcome hook.
 */
import type { TurnContext } from "@agent-core/context"
import type { TurnOutcome } from "@agent-core/hooks"

/**
 * Computes the default turn outcome from the assistant message and tool-call flag.
 *
 * @param ctx - the turn context
 * @param sawToolCall - whether the turn issued any tool call
 * @returns continue (tool calls / empty output) or break (error / final text)
 */
export function baseOutcome(ctx: TurnContext, sawToolCall: boolean): TurnOutcome {
  const session = ctx.sessions.get(ctx.sessionID)
  const assistant = session.messages.find((message) => message.id === ctx.messageID)
  const hasFinalText = assistant
    ? ctx.sessions.messageText(ctx.sessionID, assistant.id, { includeSynthetic: false }).trim().length > 0
    : false

  if (assistant?.role === "assistant" && assistant.error) return { kind: "break", reason: "assistant_error" }
  if (sawToolCall) return { kind: "continue", reason: "tool_calls" }
  if (assistant && !hasFinalText) return { kind: "continue", reason: "empty_assistant" }
  if (hasFinalText) return { kind: "break", reason: "final_text" }
  return { kind: "break", reason: "completed_without_output" }
}

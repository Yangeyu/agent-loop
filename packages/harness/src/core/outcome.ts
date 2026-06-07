// Base turn-outcome resolution: continue vs break, derived purely from the
// assistant message state and whether tool calls were seen. Policy-driven
// overrides (step budget, structured output) are applied by middleware via
// the resolveOutcome hook.
import type { TurnContext } from "@harness/core/context"
import type { TurnOutcome } from "@harness/hooks/types"
import type { AssistantMessage } from "@harness/types"

export function baseOutcome(ctx: TurnContext, sawToolCall: boolean): TurnOutcome {
  const session = ctx.session_store.get(ctx.sessionID)
  const assistant = session.messages.find((message) => message.id === ctx.assistant.id) as AssistantMessage | undefined
  const hasFinalText = assistant
    ? ctx.session_store.getMessageText(ctx.sessionID, assistant.id, { includeSynthetic: false }).trim().length > 0
    : false

  if (assistant?.error) return { kind: "break", reason: "assistant_error" }
  if (sawToolCall) return { kind: "continue", reason: "tool_calls" }
  if (assistant && !hasFinalText) return { kind: "continue", reason: "empty_assistant" }
  if (hasFinalText) return { kind: "break", reason: "final_text" }
  return { kind: "break", reason: "completed_without_output" }
}

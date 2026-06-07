// Proactive compaction as explicit session maintenance, run at beforeTurn (an
// already-effectful pre-flight point — keeps transformMessages a pure fold).
// When the estimated context exceeds contextWindow × compaction_trigger_ratio,
// it keeps the recent half of the conversation (cut at a user-message boundary)
// and replaces the older half with a single summary, persisted via replaceState.
//
// Everything compaction needs is owned here: the summarizer blueprint (model +
// prompt) is declared inline with defineAgent but is NEVER run through the loop —
// it is invoked single-shot via ctx.llm (the provider transport; the qwen
// provider selects the model from the synthetic user.model, not the caller),
// which keeps it free of tools/middleware/budgets and re-entrancy-safe.
import { defineAgent } from "@harness/agent/types"
import type { LLMInput } from "@harness/llm/types"
import { resolveModelSpec } from "@harness/llm/models"
import type { HookContext, MiddlewareFactory } from "@harness/hooks/types"
import { estimateModelTokens } from "@harness/middleware/token-estimate"
import { toModelMessages } from "@harness/session/model-message"
import {
  createID,
  type AssistantMessage,
  type CompactionPart,
  type MessagePart,
  type SessionInfo,
  type SessionMessage,
  type UserMessage,
} from "@harness/types"

const COMPACTION_MODEL_ID = "qwen3.5-flash"

const COMPACTOR_INSTRUCTIONS = [
  [
    "You are compacting a long conversation to fit a smaller context window.",
    "Produce a concise summary that preserves key facts, decisions, file paths,",
    "tool results, and open tasks. Output only the summary text.",
  ].join(" "),
]

// Summarizer blueprint: a model + prompt config carrier. Declared with the
// project's agent paradigm, but used only as a single-shot call — never runLoop.
const compactor = defineAgent({
  name: "compactor",
  mode: "subagent",
  model: { providerID: "qwen", modelID: COMPACTION_MODEL_ID, temperature: 0.2 },
  instructions: COMPACTOR_INSTRUCTIONS,
  tools: {},
})

export const compaction: MiddlewareFactory = () => ({
  name: "compaction",

  async beforeTurn(ctx) {
    const session = ctx.session_store.get(ctx.sessionID)
    const messages = toModelMessages(session)
    // ctx.system is not yet assembled at beforeTurn; the system prompt is small
    // relative to history, and the 0.75 ratio leaves headroom, so estimating
    // messages alone is sufficient to gate.
    const estimate = estimateModelTokens([], messages)
    const threshold = resolveModelSpec().contextWindow * ctx.config.compaction_trigger_ratio
    if (estimate < threshold) return { proceed: true }

    const cut = resolveCutBoundary(session.messages, ctx.config.compaction_retain_ratio)
    if (cut === undefined) return { proceed: true }

    const older = session.messages.slice(0, cut)
    const kept = session.messages.slice(cut)

    const summary = await summarizeOlderHalf(ctx, session, older)
    if (!summary) return { proceed: true }

    const compactionPart: CompactionPart = { id: createID(), type: "compaction", summary }
    ctx.session_store.replaceState({
      sessionID: ctx.sessionID,
      messages: kept,
      parts: keptPartsWithSummaryOnBoundary(session, kept, compactionPart),
    })
    ctx.events.emit({ type: "compaction", sessionID: ctx.sessionID, summary })

    return { proceed: true }
  },
})

// Keep the recent ~retain_ratio of message records, then snap the cut forward to
// the next user message so the kept window starts on a clean user turn. Returns
// the index where the kept window begins, or undefined when there is no older
// half to summarize / no user boundary to snap to.
export function resolveCutBoundary(messages: SessionMessage[], retainRatio: number): number | undefined {
  const targetKeep = Math.ceil(messages.length * retainRatio)
  const start = messages.length - targetKeep
  if (start <= 0) return undefined

  for (let index = start; index < messages.length; index += 1) {
    if (messages[index].role === "user") return index === 0 ? undefined : index
  }
  return undefined
}

async function summarizeOlderHalf(ctx: HookContext, session: SessionInfo, older: SessionMessage[]): Promise<string> {
  if (older.length === 0) return ""

  const olderSession: SessionInfo = {
    ...session,
    messages: older,
    parts: pickParts(session, older),
  }
  const olderMessages = toModelMessages(olderSession)
  if (olderMessages.length === 0) return ""

  const now = Date.now()
  const synthetic = {
    sessionID: ctx.sessionID,
    agent: compactor.name,
    // The qwen provider reads the model from user.model (not the caller's
    // selector), so this is what swaps the summarizer onto the cheaper model.
    model: { providerID: compactor.model.providerID, modelID: compactor.model.modelID },
    time: { created: now },
  }
  const user: UserMessage = { id: createID(), role: "user", ...synthetic }
  const assistant: AssistantMessage = { id: createID(), role: "assistant", parentID: user.id, ...synthetic }

  const llmInput: LLMInput = {
    session,
    user,
    assistant,
    agent: compactor,
    system: compactor.instructions,
    messages: olderMessages,
    tools: [],
    abort: ctx.abort,
  }

  let text = ""
  for await (const chunk of ctx.llm.stream(llmInput).fullStream) {
    if (chunk.type === "text-delta") text += chunk.textDelta
    else if (chunk.type === "error") break
  }
  return text.trim()
}

function pickParts(session: SessionInfo, messages: SessionMessage[]): Record<string, MessagePart[]> {
  const parts: Record<string, MessagePart[]> = {}
  for (const message of messages) {
    const messageParts = session.parts[message.id]
    if (messageParts) parts[message.id] = messageParts
  }
  return parts
}

// Preserve every kept message's parts; prepend the summary to the kept window's
// first (user) message so toModelMessages renders it as a leading context block.
function keptPartsWithSummaryOnBoundary(
  session: SessionInfo,
  kept: SessionMessage[],
  compactionPart: CompactionPart,
): Record<string, MessagePart[]> {
  const parts = pickParts(session, kept)
  const boundary = kept[0]
  if (boundary) {
    parts[boundary.id] = [compactionPart, ...(parts[boundary.id] ?? [])]
  }
  return parts
}

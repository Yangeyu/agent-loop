/**
 * Proactive compaction as explicit session maintenance, run at beforeTurn (an
 * already-effectful pre-flight point — keeps beforeModelCall a pure fold).
 * When the estimated context exceeds contextWindow × triggerRatio, it keeps the
 * recent half of the conversation (cut at a user-message boundary) and replaces
 * the older half with a single summary, persisted via replaceHistory.
 *
 * The summarizer Model is injected by the composition root and invoked
 * single-shot via .stream() — never through the loop, so compaction stays free
 * of tools/middleware/budgets and re-entrancy-safe. The gating threshold reads
 * the agent's own model spec (ctx.model.spec), so a subagent on a smaller window
 * compacts at the right point.
 */
import { COMPACTION_DEFAULTS } from "@harness/config"
import type { LLMInput, Model } from "@agent-core"
import type { HookContext, MiddlewareFactory } from "@agent-core"
import { estimateModelTokens } from "@harness/middleware/token-estimate"
import { toModelMessages } from "@agent-core"
import {
  createID,
  type CompactionPart,
  type MessagePart,
  type SessionInfo,
  type SessionMessage,
} from "@agent-core"

const COMPACTOR_INSTRUCTIONS = [
  [
    "You are compacting a long conversation to fit a smaller context window.",
    "Produce a concise summary that preserves key facts, decisions, file paths,",
    "tool results, and open tasks. Output only the summary text.",
  ].join(" "),
]

/** Where compaction triggers and how much history it keeps. */
export type CompactionOptions = {
  summarizer: Model
  triggerRatio?: number
  retainRatio?: number
}

/**
 * Builds the compaction middleware around the injected summarizer model.
 *
 * @param opts - the summarizing Model, and optional trigger/retain ratios
 */
export function createCompaction(opts: CompactionOptions): MiddlewareFactory {
  const triggerRatio = opts.triggerRatio ?? COMPACTION_DEFAULTS.triggerRatio
  const retainRatio = opts.retainRatio ?? COMPACTION_DEFAULTS.retainRatio

  return () => {
    const summarizer = opts.summarizer
    return {
      name: "compaction",

      async beforeTurn(ctx) {
        const session = ctx.sessions.get(ctx.sessionID)
        const messages = toModelMessages(session)
        // ctx.system is not yet assembled at beforeTurn; the system prompt is small
        // relative to history, and the 0.75 ratio leaves headroom, so estimating
        // messages alone is sufficient to gate.
        const estimate = estimateModelTokens([], messages)
        const threshold = ctx.model.spec.contextWindow * triggerRatio
        if (estimate < threshold) return { proceed: true }

        const cut = resolveCutBoundary(session.messages, retainRatio)
        if (cut === undefined) return { proceed: true }

        const older = session.messages.slice(0, cut)
        const kept = session.messages.slice(cut)

        const summary = await summarizeOlderHalf(ctx, summarizer, session, older)
        if (!summary) return { proceed: true }

        const compactionPart: CompactionPart = { id: createID(), type: "compaction", summary }
        // replaceHistory emits history.replaced on the state channel by itself —
        // compaction needs no event of its own.
        ctx.sessions.replaceHistory(ctx.sessionID, {
          messages: kept,
          parts: keptPartsWithSummaryOnBoundary(session, kept, compactionPart),
        })

        return { proceed: true }
      },
    }
  }
}

/**
 * Keeps the recent ~retainRatio of message records, snapping the cut forward
 * to the next user message so the kept window starts on a clean user turn.
 *
 * @returns the index where the kept window begins, or undefined when there is
 *   no older half to summarize or no user boundary to snap to
 */
export function resolveCutBoundary(messages: readonly SessionMessage[], retainRatio: number): number | undefined {
  const targetKeep = Math.ceil(messages.length * retainRatio)
  const start = messages.length - targetKeep
  if (start <= 0) return undefined

  for (let index = start; index < messages.length; index += 1) {
    if (messages[index].role === "user") return index === 0 ? undefined : index
  }
  return undefined
}

async function summarizeOlderHalf(
  ctx: HookContext,
  summarizer: Model,
  session: SessionInfo,
  older: readonly SessionMessage[],
): Promise<string> {
  if (older.length === 0) return ""

  const olderSession: SessionInfo = {
    ...session,
    messages: older,
    parts: pickParts(session, older),
  }
  const olderMessages = toModelMessages(olderSession)
  if (olderMessages.length === 0) return ""

  const llmInput: LLMInput = {
    system: COMPACTOR_INSTRUCTIONS,
    messages: olderMessages,
    tools: [],
    abort: ctx.abort,
  }

  let text = ""
  for await (const chunk of summarizer.stream(llmInput).fullStream) {
    if (chunk.type === "text-delta") text += chunk.textDelta
    else if (chunk.type === "error") break
  }
  return text.trim()
}

function pickParts(session: SessionInfo, messages: readonly SessionMessage[]): Record<string, readonly MessagePart[]> {
  const parts: Record<string, readonly MessagePart[]> = {}
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
  kept: readonly SessionMessage[],
  compactionPart: CompactionPart,
): Record<string, readonly MessagePart[]> {
  const parts = pickParts(session, kept)
  const boundary = kept[0]
  if (boundary) {
    parts[boundary.id] = [compactionPart, ...(parts[boundary.id] ?? [])]
  }
  return parts
}

/**
 * Settle-time memory extraction, at afterRun: once the run is over — however
 * it ended, the hook runs in a finally, so a crashed run's feedback is not
 * lost — a cheap injected model reads the session transcript and proposes
 * memory candidates, which consolidate against the live store under the
 * deterministic authority rules in memory/consolidate.
 *
 * Follows the compaction discipline: the extractor Model is invoked
 * single-shot via .stream(), never through the loop, so extraction stays free
 * of tools/middleware/budgets and cannot re-enter. A memory failure must
 * never change how the run ends: the whole pass is contained and reports
 * through ctx.activity instead of throwing.
 *
 * Phase gate: only `feedback` candidates are admitted for now — corrections
 * carry the clearest signal, and their archived falsified-rate is the data
 * that will justify widening extraction to the other types.
 */
import type { MiddlewareFactory, Model, RunContext } from "@agent-core"
import {
  AdjudicationSchema,
  authorize,
  CandidateMemorySchema,
  type Adjudication,
  type CandidateMemory,
} from "@harness/memory/consolidate"
import type { MemoryRecord, MemoryStore } from "@harness/memory/types"
import { z } from "zod"

// Recent turns carry the feedback; older ones only cost extractor context.
const TRANSCRIPT_CHAR_CAP = 16_000
// The comparison set is every live feedback record while the library is small;
// relevance ranking arrives with the recall(hint) backend upgrade.
const COMPARISON_CAP = 12

const EXTRACTOR_INSTRUCTIONS = [
  "You review a finished assistant session and extract durable feedback the user gave about how the assistant should work: corrections, stated preferences about approach or style, confirmed ways of working.",
  "Ignore task content, one-off instructions that only matter for this session, and anything the assistant said about itself.",
  'Reply with a JSON array only. Each element: {"name": kebab-case slug, "description": one-line summary, "type": "feedback", "body": the fact in markdown with **Why:** and **How to apply:** lines}.',
  "Most sessions contain nothing durable — then reply with [].",
].join("\n")

const ADJUDICATOR_INSTRUCTIONS = [
  "You decide how one candidate memory relates to the existing records and reply with a JSON object only.",
  'Same fact slot, refined or restated: {"action": "update", "target": name, "revision": {"description", "body"}, "reason"} — fold the candidate into the record, conditionalize instead of forking. The revision replaces the record wholesale: write one coherent body with a single **Why:** and **How to apply:**, never concatenate the old text after the new.',
  'Contradicts a record: {"action": "supersede", "target": name, "reason"}.',
  'Genuinely new: {"action": "add", "reason"}.',
  'Duplicate, not durable, or you are unsure: {"action": "drop", "reason"}. When unsure, drop — a missed fact returns with the next feedback; a wrongly deleted record has no recovery signal.',
].join("\n")

/** What settle-time extraction runs on. */
export type MemoryExtractionOptions = {
  memory: MemoryStore
  extractor: Model
}

/**
 * Builds the settle-time extraction middleware around the injected extractor
 * model. Attach it only to agents that own the memory write path (the lead).
 *
 * @param opts - the memory store and the cheap extractor Model
 */
export function createMemoryExtraction(opts: MemoryExtractionOptions): MiddlewareFactory {
  return () => ({
    name: "memory-extraction",

    async afterRun(ctx) {
      // An aborted run cannot extract — the same signal governs the extractor call.
      if (ctx.abort.aborted) return

      const transcript = renderTranscript(ctx)
      if (!transcript) return

      const activity = ctx.activity({ label: "extracting memories" })
      try {
        const candidates = await extractCandidates(ctx, opts.extractor, transcript)
        const applied = await consolidateCandidates(ctx, opts, candidates)
        activity.end(applied.length === 0 ? "nothing durable" : `saved ${applied.join(", ")}`)
      } catch (error) {
        // A memory failure is a discarded extraction, loudly — never a failed run.
        activity.end(`extraction discarded: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  })
}

async function extractCandidates(ctx: RunContext, extractor: Model, transcript: string): Promise<CandidateMemory[]> {
  const reply = await singleShot(ctx, extractor, EXTRACTOR_INSTRUCTIONS, transcript)
  const proposed = z.array(CandidateMemorySchema).parse(JSON.parse(stripFences(reply)))
  // Phase gate — see the module header.
  return proposed.filter((candidate) => candidate.type === "feedback")
}

/** Consolidates each candidate in turn; returns the names that landed. */
async function consolidateCandidates(
  ctx: RunContext,
  opts: MemoryExtractionOptions,
  candidates: CandidateMemory[],
): Promise<string[]> {
  const applied: string[] = []
  for (const candidate of candidates) {
    const decision = await adjudicate(ctx, opts, candidate)
    const name = applyDecision(opts.memory, ctx.sessionID, candidate, decision)
    if (name) applied.push(name)
  }
  return applied
}

async function adjudicate(ctx: RunContext, opts: MemoryExtractionOptions, candidate: CandidateMemory): Promise<Adjudication> {
  const comparison = opts.memory
    .recall({ types: [candidate.type] })
    .slice(0, COMPARISON_CAP)
    .map((entry) => opts.memory.read(entry.name))
    .filter((record): record is MemoryRecord => record !== null)
    .map(({ name, description, body }) => ({ name, description, body }))

  if (comparison.length === 0) return { action: "add", reason: "no existing records of this type" }

  const reply = await singleShot(
    ctx,
    opts.extractor,
    ADJUDICATOR_INSTRUCTIONS,
    JSON.stringify({ candidate, existing: comparison }),
  )
  return AdjudicationSchema.parse(JSON.parse(stripFences(reply)))
}

// The deterministic half: authorize ranks the decision, this executes what
// survived. Returns the name that changed, or undefined for a no-op.
function applyDecision(
  memory: MemoryStore,
  sessionID: string,
  candidate: CandidateMemory,
  decision: Adjudication,
): string | undefined {
  const target = decision.target ? memory.read(decision.target) : null
  const disposition = authorize(decision, "extracted", target)

  if (disposition.kind === "dispute") {
    // The one outcome that touches the target without changing its content.
    const record = memory.read(disposition.target)
    if (record && !record.disputed?.includes(sessionID)) {
      memory.upsert({ ...record, disputed: [...(record.disputed ?? []), sessionID] })
    }
    return undefined
  }

  const record = asRecord(candidate, sessionID)
  switch (disposition.decision.action) {
    case "drop":
      return undefined
    case "add":
      // An "add" onto an occupied name is a stale verdict, not a license to
      // overwrite whatever holds it — drop, the fact returns next time.
      if (memory.read(candidate.name)) return undefined
      memory.upsert(record)
      return record.name
    case "update": {
      const base = target!
      memory.upsert({
        ...base,
        description: disposition.decision.revision!.description,
        body: disposition.decision.revision!.body,
        sources: appendSource(base.sources, sessionID),
      })
      return base.name
    }
    case "supersede": {
      // A same-name supersede is an overwrite of the slot, not an archival.
      if (target!.name === record.name) {
        memory.upsert({ ...record, sources: appendSource(target!.sources, sessionID) })
      } else {
        memory.upsert(record, { supersedes: [target!.name] })
      }
      return record.name
    }
  }
}

function asRecord(candidate: CandidateMemory, sessionID: string): MemoryRecord {
  return { ...candidate, scope: "workspace", origin: "extracted", sources: [sessionID] }
}

function appendSource(sources: string[], sessionID: string): string[] {
  return sources.includes(sessionID) ? sources : [...sources, sessionID]
}

// The transcript is the user/assistant text turns, newest-biased under the
// char cap — tool traffic carries no feedback and would dominate the budget.
function renderTranscript(ctx: RunContext): string {
  const session = ctx.sessions.get(ctx.sessionID)
  const turns: string[] = []
  for (const message of session.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue
    const text = ctx.sessions.messageText(ctx.sessionID, message.id).trim()
    if (text) turns.push(`${message.role}: ${text}`)
  }
  if (!turns.some((turn) => turn.startsWith("user:"))) return ""

  let transcript = turns.join("\n\n")
  if (transcript.length > TRANSCRIPT_CHAR_CAP) transcript = transcript.slice(-TRANSCRIPT_CHAR_CAP)
  return transcript
}

async function singleShot(ctx: RunContext, model: Model, instructions: string, content: string): Promise<string> {
  let text = ""
  const stream = model.stream({
    system: [instructions],
    messages: [{ role: "user", content: [{ type: "text", text: content }] }],
    tools: [],
    abort: ctx.abort,
  })
  for await (const chunk of stream.fullStream) {
    if (chunk.type === "text-delta") text += chunk.textDelta
    else if (chunk.type === "error") throw new Error("extractor stream failed")
  }
  return text.trim()
}

// Models habitually wrap JSON in a code fence; unwrapping one is
// normalization, not repair — anything else still fails the parse.
function stripFences(reply: string): string {
  const match = reply.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return match ? match[1] : reply
}

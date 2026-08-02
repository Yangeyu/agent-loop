/**
 * Consolidation vocabulary for the write path: the extractor's candidate
 * shape, the adjudicator's decision shape, and the deterministic authority
 * rule applied on top of the model's semantic verdict. The model proposes,
 * policy disposes — no decision executes until `authorize` confirms the
 * candidate outranks its target. Both schemas parse untrusted model output;
 * anything that fails to parse is a dropped candidate, never a repaired one.
 */
import { z } from "zod"
import { MEMORY_NAME_PATTERN, MEMORY_TYPES, type MemoryOrigin, type MemoryRecord } from "@harness/memory/types"

/**
 * What extraction proposes: the fact alone. Scope, origin, and source session
 * are the caller's facts, assigned when the candidate enters consolidation —
 * a model never gets to claim its own authority.
 */
export const CandidateMemorySchema = z.object({
  name: z.string().regex(MEMORY_NAME_PATTERN),
  description: z.string().min(1),
  type: z.enum(MEMORY_TYPES),
  body: z.string().min(1),
})

export type CandidateMemory = z.infer<typeof CandidateMemorySchema>

/**
 * The adjudicator's verdict on one candidate against its comparison set.
 *
 * - `add` — new fact, no live record covers it
 * - `update` — same fact slot as `target`; `revision` carries the merged
 *   record content (refinements land here too: conditionalize, don't fork)
 * - `supersede` — contradicts `target`; the candidate replaces it
 * - `drop` — duplicate, not durable, or the adjudicator is unsure. Unsure
 *   defaults to drop by instruction: a missed fact returns with the next
 *   feedback, a wrongly deleted record has no recovery signal.
 */
export const AdjudicationSchema = z
  .object({
    action: z.enum(["add", "update", "supersede", "drop"]),
    /** The live record the action lands on; required for update/supersede. */
    target: z.string().regex(MEMORY_NAME_PATTERN).optional(),
    /**
     * The merged content an update writes over the target — the adjudicator
     * folds the candidate into the existing fact rather than forking it.
     * Required for update, meaningless otherwise.
     */
    revision: z.object({ description: z.string().min(1), body: z.string().min(1) }).optional(),
    /** The adjudicator's stated basis — kept for dispute marks and logs. */
    reason: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if ((value.action === "update" || value.action === "supersede") && !value.target) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${value.action} requires a target` })
    }
    if (value.action === "update" && !value.revision) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "update requires a revision" })
    }
  })

export type Adjudication = z.infer<typeof AdjudicationSchema>

/**
 * The authority check's outcome. `apply` carries the (possibly downgraded)
 * decision to execute against the store; `dispute` means the candidate is
 * discarded and the target record gets a dispute mark instead — it is the
 * one disposition that touches the target without changing its content.
 */
export type Disposition =
  | { kind: "apply"; decision: Adjudication }
  | { kind: "dispute"; target: string; reason: string }

/**
 * Deterministic authority rule, applied after the semantic verdict and before
 * any store write. Two clauses, both about refusing to let a model's judgment
 * execute beyond its rank:
 *
 * - a target the adjudicator named but the store no longer has is a stale
 *   verdict — downgraded to drop, loudly carried in the reason
 * - an extracted candidate never overwrites an explicit record — downgraded
 *   to a dispute mark for a human-ranked decision later
 *
 * @param decision - the parsed adjudicator verdict
 * @param candidateOrigin - which write path the candidate arrived through
 * @param target - the resolved live record for update/supersede, else null
 * @returns what may actually execute
 */
export function authorize(decision: Adjudication, candidateOrigin: MemoryOrigin, target: MemoryRecord | null): Disposition {
  if (decision.action === "add" || decision.action === "drop") {
    return { kind: "apply", decision }
  }

  if (!target) {
    return {
      kind: "apply",
      decision: { action: "drop", reason: `target "${decision.target}" not found (stale verdict): ${decision.reason}` },
    }
  }

  if (candidateOrigin === "extracted" && target.origin === "explicit") {
    return { kind: "dispute", target: target.name, reason: decision.reason }
  }

  return { kind: "apply", decision }
}

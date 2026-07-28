/**
 * The prompt composition vocabulary: what a system-prompt fragment is and
 * where it sits, nothing else. Each fragment itself lives with whatever owns
 * it — the budget middleware states the step budget, the skill tool announces
 * skills, an agent states its own role.
 *
 * The engine's `ContextDraft.system` is an ordered list of strings and nothing
 * more; the engine owns the mechanism, this layer owns the policy (what goes
 * in it, and in what order).
 *
 * SLOT_ORDER is the single place the system prompt's shape is decided. A
 * contributor declares which slot it belongs to; registration order never
 * decides where a fragment renders. Two properties fall out of that:
 *
 *   - identity leads, so the first thing the model reads is who it is.
 *   - `volatile` trails, so every fragment a provider could cache as a stable
 *     prefix sits ahead of the one section that changes each step.
 */

import type { HookContext } from "@agent-core"

/**
 * Where a fragment renders in the system prompt:
 *
 * - `identity` — who the agent is; seeded from the blueprint's `instructions`.
 * - `convention` — how the engine expects any agent to work.
 * - `capability` — what this agent can reach: skills, delegable subagents.
 * - `policy` — constraints this request carries, e.g. a structured schema.
 * - `volatile` — per-step state; changes every turn, so it renders last.
 */
export type PromptSlot = "identity" | "convention" | "capability" | "policy" | "volatile"

export const SLOT_ORDER: readonly PromptSlot[] = ["identity", "convention", "capability", "policy", "volatile"]

/** One system-prompt fragment plus the slot that decides where it renders. */
export type SystemSection = {
  slot: PromptSlot
  text: string
}

/**
 * Produces zero or more system sections for one turn.
 *
 * A contributor is a pure read of the turn context — it never writes session
 * state and never sees the draft, so it cannot depend on what another
 * contributor produced. That is what makes the rendered order a property of
 * SLOT_ORDER alone. Returning `undefined` means "nothing to say this turn".
 */
export type PromptContributor = (
  ctx: HookContext,
) => SystemSection | SystemSection[] | undefined | Promise<SystemSection | SystemSection[] | undefined>

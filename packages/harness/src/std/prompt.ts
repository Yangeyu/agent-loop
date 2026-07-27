// The prompt composition vocabulary. This is a *contract*, not a module: it says
// what a system-prompt fragment is and where it sits, and nothing else. Each
// fragment itself lives with whatever owns it — the budget middleware states the
// step budget, the skill tool announces skills, an agent states its own role.
//
// It lives in std, not in the kernel: `ContextDraft.system` is an ordered list of
// strings and nothing more, so slot semantics never leak into `agent/`. The
// kernel owns the mechanism (there is a system list); std owns the policy (what
// goes in it, and in what order).
//
// SLOT_ORDER is the single place the system prompt's shape is decided. A
// contributor declares which slot it belongs to; the order contributors are
// registered in never decides where they render. Two properties fall out of that:
//
//   - identity leads, so the first thing the model reads is who it is — not a
//     generic preamble that contradicts the agent's own role statement.
//   - `volatile` trails, so every fragment a provider could cache as a stable
//     prefix sits ahead of the one section that changes each step.

import type { HookContext } from "@harness/agent/hooks"

export type PromptSlot =
  // Who the agent is and what its role is. Seeded from the blueprint's `instructions`.
  | "identity"
  // How the engine expects any agent to work: tool usage, grounding, completion.
  | "convention"
  // What this agent can reach right now: available skills, delegable subagents.
  | "capability"
  // Constraints this particular request carries, e.g. a structured output schema.
  | "policy"
  // Per-step state. Changes every turn, so it is always rendered last.
  | "volatile"

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

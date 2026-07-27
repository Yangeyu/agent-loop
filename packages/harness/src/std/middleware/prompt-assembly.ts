// The one middleware that writes `draft.system`. Everything an agent says to the
// model arrives as a contributor, so the system prompt's order is declared by
// SLOT_ORDER rather than emerging from where a middleware happens to sit in the
// agent's middleware array.
//
// The distinction that keeps the two axes apart: this middleware owns *prompt
// composition*; a middleware that transforms `draft.messages` (view-image) or
// gates/judges a turn (budget, doom-loop, structured-output) is on the
// *execution* axis and must not append to `system`.
import type { MiddlewareFactory } from "@harness/agent/hooks"
import { SLOT_ORDER, type PromptContributor, type SystemSection } from "@harness/std/prompt"

/**
 * Builds the prompt-assembly middleware from an ordered contributor list.
 *
 * @param contributors - the fragments this agent may emit; registration order
 *   decides nothing but tie-breaks within a single slot
 */
export function promptAssembly(contributors: readonly PromptContributor[]): MiddlewareFactory {
  return () => ({
    name: "prompt-assembly",

    async beforeModelCall(ctx, draft) {
      // The engine seeds the draft with the agent's own `instructions` so an
      // agent with zero middleware still speaks its blueprint. Those fragments
      // are the identity slot's content — the agent's words are not a separate
      // mechanism from the rest of the prompt, just the first slot of it.
      const sections: SystemSection[] = draft.system
        .filter(Boolean)
        .map((text) => ({ slot: "identity" as const, text }))

      for (const contribute of contributors) {
        const produced = await contribute(ctx)
        if (!produced) continue
        if (Array.isArray(produced)) sections.push(...produced)
        else sections.push(produced)
      }

      return { ...draft, system: renderSections(sections) }
    },
  })
}

// Group by slot in SLOT_ORDER, preserving contribution order inside a slot.
function renderSections(sections: readonly SystemSection[]): string[] {
  return SLOT_ORDER.flatMap((slot) =>
    sections
      .filter((section) => section.slot === slot)
      .map((section) => section.text.trim())
      .filter(Boolean),
  )
}

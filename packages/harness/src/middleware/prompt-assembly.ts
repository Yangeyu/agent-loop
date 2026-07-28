// The one middleware that writes `draft.system`. Everything an agent says to
// the model arrives as a contributor, so the system prompt's order is declared
// by SLOT_ORDER, independent of middleware position. A middleware that
// transforms `draft.messages` or gates/judges a turn is on the *execution*
// axis and must not append to `system`.
import type { MiddlewareFactory } from "@agent-core"
import { SLOT_ORDER, type PromptContributor, type SystemSection } from "@harness/prompt"

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
      // The engine seeds the draft with the agent's own `instructions`; those
      // fragments become the identity slot's content.
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

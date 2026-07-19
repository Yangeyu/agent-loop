// General-private middleware. Reinforces that a subagent must conclude with a
// stand-alone deliverable the lead can consume directly.
import type { MiddlewareFactory } from "@harness/agent/hooks"

export const deliverableGuidance: MiddlewareFactory = () => ({
  name: "deliverable-guidance",
  assembleContext(_ctx, draft) {
    return {
      ...draft,
      system: [
        ...draft.system,
        "Finish with a final answer that stands on its own without referencing this subagent's intermediate steps.",
      ],
    }
  },
})

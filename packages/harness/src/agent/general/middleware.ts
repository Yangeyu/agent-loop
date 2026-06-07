// General-private middleware. Reinforces that a subagent must conclude with a
// stand-alone deliverable the lead can consume directly.
import type { MiddlewareFactory } from "@harness/hooks/types"

export const deliverableGuidance: MiddlewareFactory = () => ({
  name: "deliverable-guidance",
  contributeSystem() {
    return [
      "Finish with a final answer that stands on its own without referencing this subagent's intermediate steps.",
    ]
  },
})

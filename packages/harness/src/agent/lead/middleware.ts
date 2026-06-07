// Lead-private middleware. Injects the list of delegable subagents into the
// system prompt (replacing the former task-tool description augmentation).
import type { MiddlewareFactory } from "@harness/hooks/types"

export const subagentList: MiddlewareFactory = () => ({
  name: "subagent-list",
  contributeSystem(ctx) {
    const subagents = ctx.agent_registry.list().filter((agent) => agent.mode === "subagent")
    if (subagents.length === 0) return []

    return [
      [
        "Delegate work to these subagents via the task tool's subagent_type argument:",
        "<available_subagents>",
        ...subagents.map((agent) => `- ${agent.name}: ${agent.description ?? "Specialist subagent"}`),
        "</available_subagents>",
      ].join("\n"),
    ]
  },
})

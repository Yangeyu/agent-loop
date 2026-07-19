// Lead-private middleware. Injects the list of delegable subagents into the
// system prompt (replacing the former task-tool description augmentation).
import type { MiddlewareFactory } from "@harness/agent/hooks"

export const subagentList: MiddlewareFactory = () => ({
  name: "subagent-list",
  assembleContext(ctx, draft) {
    const subagents = ctx.agent_registry.list().filter((agent) => agent.mode === "subagent")
    if (subagents.length === 0) return draft

    return {
      ...draft,
      system: [
        ...draft.system,
        [
          "Delegate work to these subagents via the task tool's subagent_type argument:",
          "<available_subagents>",
          ...subagents.map((agent) => `- ${agent.name}: ${agent.description ?? "Specialist subagent"}`),
          "</available_subagents>",
        ].join("\n"),
      ],
    }
  },
})

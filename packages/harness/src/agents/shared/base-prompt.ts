// The prompt baseline every agent shares: how the engine expects any agent to
// work, regardless of which one is running. Anything narrower belongs to whoever
// owns it — the budget middleware states the step budget, the skill tool
// announces skills, an agent's own `instructions` state its role.
import type { PromptContributor } from "@harness/prompt"

// This used to be split across three places — a base system prompt, a tool-use
// prompt, and a shared instruction fragment list — with the agent's own identity
// sandwiched between them. They say one thing, so they are one section.
const ENGINE_CONVENTIONS = [
  "Complete the user's request by making concrete progress, not by restating plans.",
  "Continue working until the task is complete or you must stop.",
  "When the task needs external information or an action, call a tool instead of guessing;",
  "prefer a dedicated tool over a shell command when one fits.",
  "Treat tool results as trusted execution context and ground every step in them rather than in assumptions.",
  "After a tool result, either continue with another needed tool call or produce the final answer.",
].join(" ")

/** States the engine's working conventions. Constant — the cacheable prefix. */
export const engineConventions: PromptContributor = () => ({ slot: "convention", text: ENGINE_CONVENTIONS })

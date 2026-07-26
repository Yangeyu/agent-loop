// Renders the system prompt around the draft: generic engine guidance wraps the
// agent's own instruction fragments (seeded by the engine), then available
// skills and step guidance. Structured-output instructions are contributed
// separately by the structured-output middleware.
import type { MiddlewareFactory } from "@harness/agent/hooks"
import { isFinalAllowedStep } from "@harness/agent/policy"

const BASE_SYSTEM_PROMPT = [
  "You are a general-purpose assistant.",
  "Complete the user's request by making concrete progress, not by restating plans.",
  "Use available tools whenever they help you inspect code, gather information, or take action.",
  "Treat tool results as trusted execution context and build on them in the next step.",
  "Continue working until the task is complete or you must stop.",
].join(" ")

const TOOL_USE_SYSTEM_PROMPT = [
  "If the task requires external information or an action, call the appropriate tool instead of guessing.",
  "After receiving a tool result, either continue with another needed tool call or produce the final answer.",
].join(" ")

export const contextAssembly: MiddlewareFactory = () => ({
  name: "context-assembly",
  assembleContext(ctx, draft) {
    const prompts: string[] = [BASE_SYSTEM_PROMPT, ...draft.system.filter(Boolean), TOOL_USE_SYSTEM_PROMPT]

    const skills = ctx.skill_registry.list()
    if (skills.length > 0) {
      prompts.push(
        [
          "Use the skill tool when the task matches one of these specialized workflows.",
          "<available_skills>",
          ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
          "</available_skills>",
        ].join("\n"),
      )
    }

    if (isFinalAllowedStep(ctx.policy.budget, ctx.step)) {
      prompts.push("This is your final allowed step. Conclude decisively and avoid leaving work unfinished.")
    } else if (ctx.step > 1) {
      prompts.push("Continue the existing task and use any new context to make concrete progress.")
    }

    return { ...draft, system: prompts }
  },
})

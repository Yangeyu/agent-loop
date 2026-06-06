import { buildStructuredOutputSystemPrompt } from "@harness/session/structured-output"
import type { AgentInfo, UserMessage } from "@harness/types"
import type { SkillInfo } from "@harness/skill/types"

const BASE_SYSTEM_PROMPT = [
  "You are OpenCode, a general-purpose assistant.",
  "Complete the user's request by making concrete progress, not by restating plans.",
  "Use available tools whenever they help you inspect code, gather information, or take action.",
  "Treat tool results as trusted execution context and build on them in the next step.",
  "Continue working until the task is complete or you must stop.",
].join(" ")

const TOOL_USE_SYSTEM_PROMPT = [
  "If the task requires external information or an action, call the appropriate tool instead of guessing.",
  "After receiving a tool result, either continue with another needed tool call or produce the final answer.",
].join(" ")

export function buildSystemPrompt(input: {
  agent: AgentInfo
  format?: UserMessage["format"]
  skills: SkillInfo[]
  step: number
  maxSteps: number
}) {
  const prompts = [BASE_SYSTEM_PROMPT, input.agent.prompt].filter((value): value is string => Boolean(value))
  prompts.push(TOOL_USE_SYSTEM_PROMPT)

  if (input.skills.length > 0) {
    prompts.push([
      "Use the skill tool when the task matches one of these specialized workflows.",
      "<available_skills>",
      ...input.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
      "</available_skills>",
    ].join("\n"))
  }

  if (input.step >= input.maxSteps) {
    prompts.push(
      "This is your final allowed step. Conclude decisively and avoid leaving work unfinished.",
    )
  } else if (input.step > 1) {
    prompts.push("Continue the existing task and use any new context to make concrete progress.")
  }

  const structuredOutputPrompt = buildStructuredOutputSystemPrompt(input.format)
  if (structuredOutputPrompt) prompts.push(structuredOutputPrompt)

  return prompts
}

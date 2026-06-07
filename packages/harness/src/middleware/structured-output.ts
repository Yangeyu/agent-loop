// Structured output: contributes the JSON instruction, parses the final text on
// turn finish (failing the turn on invalid JSON), and breaks the loop once a
// structured result is captured.
import type { MiddlewareFactory } from "@harness/hooks/types"
import type { AssistantMessage, OutputFormat } from "@harness/types"

export const structuredOutput: MiddlewareFactory = () => ({
  name: "structured-output",

  contributeSystem(ctx) {
    const prompt = buildStructuredOutputSystemPrompt(ctx.format)
    return prompt ? [prompt] : []
  },

  onTurnFinish(ctx, finish) {
    if (!hasStructuredOutputFormat(ctx.format)) return { ok: true }

    const parsed = parseStructuredOutputText(finish.text)
    if (!parsed.success) {
      return { ok: false, error: { message: parsed.error, retryable: false, code: "invalid_structured_output" } }
    }
    return { ok: true, structured: parsed.data }
  },

  resolveOutcome(ctx, outcome) {
    const assistant = ctx.session_store
      .get(ctx.sessionID)
      .messages.find((message) => message.id === ctx.turnID) as AssistantMessage | undefined
    if (assistant?.structured !== undefined) {
      return { kind: "break", reason: "structured_output" }
    }
    return outcome
  },
})

export function hasStructuredOutputFormat(format?: OutputFormat) {
  return format?.type === "json_schema"
}

export function buildStructuredOutputSystemPrompt(format?: OutputFormat) {
  if (!hasStructuredOutputFormat(format)) return undefined

  return [
    "IMPORTANT: The user requested structured output.",
    "Return the final answer as valid JSON only.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include any explanatory text before or after the JSON.",
    `JSON Schema:\n${JSON.stringify(format.schema, null, 2)}`,
  ].join("\n")
}

export function parseStructuredOutputText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false as const, error: "Structured output response was empty." }
  }

  const normalized = stripJsonCodeFence(trimmed)
  try {
    return { success: true as const, data: JSON.parse(normalized) as unknown }
  } catch {
    return { success: false as const, error: "Structured output response was not valid JSON." }
  }
}

function stripJsonCodeFence(text: string) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1] ?? text
}

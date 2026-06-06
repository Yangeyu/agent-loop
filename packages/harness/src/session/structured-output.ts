import type { OutputFormat } from "@harness/types"

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
    return {
      success: false as const,
      error: "Structured output response was empty.",
    }
  }

  const normalized = stripJsonCodeFence(trimmed)
  try {
    return {
      success: true as const,
      data: JSON.parse(normalized) as unknown,
    }
  } catch {
    return {
      success: false as const,
      error: "Structured output response was not valid JSON.",
    }
  }
}

function stripJsonCodeFence(text: string) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1] ?? text
}

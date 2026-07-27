// Structured output spans both axes: it asks for JSON (prompt) and it enforces
// JSON (judgment). Those halves ship as one module so the request and the check
// cannot drift, but they enter through different doors — the contributor is
// registered on the prompt axis, the middleware on the execution axis. The
// shared `hasStructuredOutputFormat` predicate is what keeps them in step.
//
// The middleware parses the final text only once the loop would otherwise break,
// either attaching the structured result to the terminal or failing the turn on
// invalid JSON. Turns that continue (tool calls, empty output) are never parsed.
import type { MiddlewareFactory } from "@harness/agent/hooks"
import type { PromptContributor } from "@harness/std/prompt"
import type { OutputFormat } from "@harness/types"

/** Prompt axis: states the requested schema. Absent unless this turn asked for JSON. */
export const structuredOutputPrompt: PromptContributor = (ctx) => {
  const text = buildStructuredOutputSystemPrompt(ctx.format)
  return text ? { slot: "policy", text } : undefined
}

/** Execution axis: parses and validates the final text against that request. */
export const structuredOutput: MiddlewareFactory = () => ({
  name: "structured-output",

  judgeTurn(ctx, judgment) {
    if (!hasStructuredOutputFormat(ctx.format)) return judgment
    // Only judge a turn that ended cleanly and is about to conclude the loop:
    // intermediate tool-call turns have no final text to parse.
    if (!judgment.terminal?.ok || judgment.outcome.kind !== "break") return judgment

    const parsed = parseStructuredOutputText(judgment.finish.text)
    if (!parsed.success) {
      return {
        ...judgment,
        terminal: { ok: false, error: { message: parsed.error, retryable: false, code: "invalid_structured_output" } },
        outcome: { kind: "break", reason: "assistant_error" },
      }
    }
    return {
      ...judgment,
      terminal: { ...judgment.terminal, structured: parsed.data },
      outcome: { kind: "break", reason: "structured_output" },
    }
  },
})

export function hasStructuredOutputFormat(format?: OutputFormat) {
  return format?.type === "json_schema"
}

function buildStructuredOutputSystemPrompt(format?: OutputFormat) {
  if (!hasStructuredOutputFormat(format)) return undefined

  return [
    "IMPORTANT: The user requested structured output.",
    "Return the final answer as valid JSON only.",
    "Do not wrap the JSON in Markdown fences.",
    "Do not include any explanatory text before or after the JSON.",
    `JSON Schema:\n${JSON.stringify(format.schema, null, 2)}`,
  ].join("\n")
}

function parseStructuredOutputText(text: string) {
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

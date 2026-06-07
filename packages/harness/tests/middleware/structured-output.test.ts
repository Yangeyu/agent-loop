import { describe, expect, it } from "bun:test"
import { createTestRuntime, runPrompt, type AssistantMessage } from "@harness"
import { corePlugin } from "@harness/module"
import type { ModelProvider } from "@harness/agent/model"
import type { LLMChunk } from "@harness/llm/types"

// Scripts the model stream so the loop runs deterministically without a provider.
function scriptedProvider(chunks: LLMChunk[]): ModelProvider {
  return () => ({
    fullStream: (async function* () {
      for (const chunk of chunks) yield chunk
    })(),
  })
}

const JSON_FORMAT = { type: "json_schema" as const, schema: { type: "object" } }

async function lastAssistant(provider: ModelProvider) {
  const runtime = await createTestRuntime({
    plugins: [corePlugin],
    model_provider: provider,
  })
  const session = await runPrompt({
    runtime,
    agent: "lead",
    text: "produce structured output",
    format: JSON_FORMAT,
  })
  return [...session.messages].reverse().find((message) => message.role === "assistant") as AssistantMessage
}

describe("structured-output middleware", () => {
  it("captures parsed JSON into assistant.structured on finish", async () => {
    const provider = scriptedProvider([
      { type: "text-delta", textDelta: '{"ok":true}' },
      { type: "finish", finishReason: "stop" },
    ])

    const assistant = await lastAssistant(provider)
    expect(assistant.structured).toEqual({ ok: true })
    expect(assistant.error).toBeUndefined()
  })

  it("fails the turn when structured output is not valid JSON", async () => {
    const provider = scriptedProvider([
      { type: "text-delta", textDelta: "not json" },
      { type: "finish", finishReason: "stop" },
    ])

    const assistant = await lastAssistant(provider)
    expect(assistant.structured).toBeUndefined()
    expect(assistant.finish).toBe("error")
    expect(assistant.error?.code).toBe("invalid_structured_output")
  })
})

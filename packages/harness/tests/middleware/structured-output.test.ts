import { describe, expect, it } from "bun:test"
import { createAgent } from "@agent-core"
import {
  baseMiddleware,
  createTestRuntime,
  runPrompt,
} from "@harness"
import {
  type AssistantMessage,
} from "@agent-core"
import type { LLMChunk } from "@agent-core/llm/types"
import { createFakeModel } from "@agent-core"

const JSON_FORMAT = { type: "json_schema" as const, schema: { type: "object" } }

// Runs one prompt against a primary agent whose model replays the given chunks,
// so the structured-output middleware is exercised without a network provider.
async function lastAssistant(chunks: LLMChunk[]) {
  const runtime = createTestRuntime()
  runtime.agent_registry.register(createAgent({
    name: "lead",
    model: createFakeModel({ chunks }),
    middleware: baseMiddleware(),
    deps: runtime,
  }), { mode: "primary" })
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
    const assistant = await lastAssistant([
      { type: "text-delta", textDelta: '{"ok":true}' },
      { type: "finish", finishReason: "stop" },
    ])
    expect(assistant.structured).toEqual({ ok: true })
    expect(assistant.error).toBeUndefined()
  })

  it("fails the step when structured output is not valid JSON", async () => {
    const assistant = await lastAssistant([
      { type: "text-delta", textDelta: "not json" },
      { type: "finish", finishReason: "stop" },
    ])
    expect(assistant.structured).toBeUndefined()
    expect(assistant.finish).toBe("error")
    expect(assistant.error?.code).toBe("invalid_structured_output")
  })
})

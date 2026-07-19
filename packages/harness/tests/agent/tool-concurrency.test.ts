import { describe, expect, it } from "bun:test"
import { baseMiddleware, createTestRuntime, defineAgent, defineTool, runPrompt } from "@harness"
import type { LLMChunk, LLMInput, Model } from "@harness/llm/types"
import type { ToolPart } from "@harness/types"
import { z } from "zod"

// A model that issues the given tool calls in its first turn, then a plain answer
// on the second — so one turn fans out the whole set and the loop then terminates.
function callsThenAnswer(calls: { toolCallId: string; toolName: string; args: unknown }[]): Model {
  let turn = 0
  const first: LLMChunk[] = [
    ...calls.map((call) => ({ type: "tool-call" as const, ...call })),
    { type: "finish", finishReason: "tool-calls" },
  ]
  const answer: LLMChunk[] = [
    { type: "text-delta", textDelta: "done" },
    { type: "finish", finishReason: "stop" },
  ]
  return {
    providerID: "fake",
    spec: {
      id: "fake-model",
      capabilities: { tools: true, reasoning: false, structuredOutput: false, streaming: true, vision: false, parallelToolCalls: true },
      contextWindow: 100_000,
    },
    stream(_input: LLMInput) {
      const chunks = turn === 0 ? first : answer
      turn += 1
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
  }
}

describe("concurrent tool dispatch", () => {
  it("runs a turn's tool calls in parallel, capped at the concurrency limit", async () => {
    // Four calls under a limit of 2, each holding a slot for a beat: the peak
    // simultaneous count settles at exactly the limit — above 1 shows the calls
    // overlap, and never above 2 shows the limit holds.
    const ids = ["t0", "t1", "t2", "t3"]
    let inFlight = 0
    let peakInFlight = 0

    const probe = (id: string) =>
      defineTool({
        id,
        description: `concurrency probe ${id}`,
        parameters: z.object({}),
        async execute() {
          inFlight += 1
          peakInFlight = Math.max(peakInFlight, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 20))
          inFlight -= 1
          return { output: id }
        },
      })

    const agent = defineAgent({
      name: "runner",
      mode: "primary",
      model: callsThenAnswer(ids.map((id) => ({ toolCallId: `call-${id}`, toolName: id, args: {} }))),
      tools: Object.fromEntries(ids.map((id) => [id, true])),
      middleware: baseMiddleware(),
    })
    const runtime = await createTestRuntime({
      agents: [agent], tools: ids.map(probe),
      config: { tool_max_concurrency: 2 },
    })

    const session = await runPrompt({ runtime, agent: "runner", text: "go" })
    const assistant = runtime.sessions.get(session.id).messages.find((message) => message.role === "assistant")
    if (!assistant) throw new Error("expected an assistant message")
    const parts = runtime.sessions.parts(session.id, assistant.id).filter((part): part is ToolPart => part.type === "tool")

    expect(peakInFlight).toBe(2)
    expect(parts.map((part) => part.toolName)).toEqual(ids)
    expect(parts.every((part) => part.state.status === "completed")).toBe(true)
  })
})

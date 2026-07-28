import { describe, expect, it } from "bun:test"
import { createAgent } from "@agent-core"
import {
  baseMiddleware,
  createTestRuntime,
  runPrompt,
} from "@harness"
import {
  defineTool,
} from "@agent-core"
import type { LLMChunk, LLMInput, Model } from "@agent-core/llm/types"
import type { ToolPart } from "@agent-core/types"
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

// Runs one turn whose batch is the given tools, and reports how many of them
// were ever in flight at the same time.
async function measurePeakInFlight(input: { ids: string[]; limit: number }) {
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

  const runtime = createTestRuntime({ config: { tool_max_concurrency: input.limit } })
  runtime.agent_registry.register(createAgent({
    name: "runner",
    model: callsThenAnswer(input.ids.map((id) => ({ toolCallId: `call-${id}`, toolName: id, args: {} }))),
    tools: input.ids.map(probe),
    middleware: baseMiddleware(),
    deps: runtime,
  }), { mode: "primary" })

  const session = await runPrompt({ runtime, agent: "runner", text: "go" })
  const assistant = runtime.sessions.get(session.id).messages.find((message) => message.role === "assistant")
  if (!assistant) throw new Error("expected an assistant message")
  const parts = runtime.sessions.parts(session.id, assistant.id).filter((part): part is ToolPart => part.type === "tool")

  return { peakInFlight, parts }
}

describe("concurrent tool dispatch", () => {
  it("runs a batch in parallel, capped at the concurrency limit", async () => {
    // Four calls under a limit of 2, each holding a slot for a beat: the peak
    // simultaneous count settles at exactly the limit — above 1 shows the calls
    // overlap, and never above 2 shows the limit holds.
    const ids = ["t0", "t1", "t2", "t3"]

    const { peakInFlight, parts } = await measurePeakInFlight({ ids, limit: 2 })

    expect(peakInFlight).toBe(2)
    expect(parts.map((part) => part.toolName)).toEqual(ids)
    expect(parts.every((part) => part.state.status === "completed")).toBe(true)
  })

  it("dispatches on the limit alone, never on what a tool does", async () => {
    // A mutating tool is dispatched exactly like a read-only one. The dispatcher
    // has no tool-shaped knowledge to act on, and needs none: file consistency is
    // the workspace's guarantee (see workspace.test.ts), not a scheduling one.
    const { peakInFlight } = await measurePeakInFlight({ ids: ["reader", "writer"], limit: 4 })

    expect(peakInFlight).toBe(2)
  })

  it("serializes when the limit says so", async () => {
    const { peakInFlight, parts } = await measurePeakInFlight({ ids: ["a", "b", "c"], limit: 1 })

    expect(peakInFlight).toBe(1)
    expect(parts.every((part) => part.state.status === "completed")).toBe(true)
  })
})

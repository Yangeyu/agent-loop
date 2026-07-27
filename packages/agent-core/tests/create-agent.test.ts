import { describe, expect, it } from "bun:test"
import {
  createAgent,
  defineTool,
} from "@agent-core"
import type { LLMChunk, LLMInput, Model } from "@agent-core/llm/types"
import { z } from "zod"

// A model that issues one echo tool call, then answers with its instructions'
// presence so the test can assert the system prompt actually reached the model.
function probeModel(): { model: Model; seenSystem: string[][] } {
  const seenSystem: string[][] = []
  let turn = 0
  const model: Model = {
    providerID: "fake",
    spec: {
      id: "fake-model",
      capabilities: { tools: true, reasoning: false, structuredOutput: false, streaming: true, vision: false, parallelToolCalls: true },
      contextWindow: 100_000,
    },
    stream(input: LLMInput) {
      seenSystem.push([...input.system])
      const chunks: LLMChunk[] =
        turn === 0
          ? [
              { type: "tool-call", toolCallId: "c1", toolName: "echo", args: {} },
              { type: "finish", finishReason: "tool-calls" },
            ]
          : [
              { type: "text-delta", textDelta: "standalone done" },
              { type: "finish", finishReason: "stop" },
            ]
      turn += 1
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
  }
  return { model, seenSystem }
}

const echoTool = defineTool({
  id: "echo",
  description: "echoes",
  parameters: z.object({}),
  async execute() {
    return { output: "ok" }
  },
})

describe("createAgent standalone atom", () => {
  it("runs model + tools with zero middleware, honoring instructions", async () => {
    const { model, seenSystem } = probeModel()
    const agent = createAgent({
      model,
      instructions: ["You are a standalone probe."],
      tools: [echoTool],
      steps: 3,
    })

    const session = await agent.run({ text: "go" })

    // Instructions reach the model without any middleware in the stack.
    expect(seenSystem[0]).toEqual(["You are a standalone probe."])
    const assistants = session.messages.filter((message) => message.role === "assistant")
    expect(assistants.length).toBe(2)
    expect(agent.sessions.messageText(session.id, assistants[1].id)).toBe("standalone done")
  })

  it("keeps sessions private to the atom and continues one via sessionID", async () => {
    const { model } = probeModel()
    const agent = createAgent({ model, tools: [echoTool], steps: 3 })

    const first = await agent.run({ text: "one" })
    const again = await agent.run({ text: "two", sessionID: first.id })

    expect(again.id).toBe(first.id)
    expect(again.messages.filter((message) => message.role === "user").length).toBe(2)
  })
})

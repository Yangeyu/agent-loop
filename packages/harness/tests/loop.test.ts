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
import type { LLMChunk, LLMInput, Model } from "@agent-core"
import type { AssistantMessage, ToolPart } from "@agent-core"
import { z } from "zod"

// A model that replays one scripted chunk list per step, then keeps answering
// "done" if the loop asks for more steps than scripted.
function scripted(steps: LLMChunk[][]): Model {
  let step = 0
  return {
    providerID: "fake",
    spec: {
      id: "fake-model",
      capabilities: { tools: true, reasoning: false, structuredOutput: false, streaming: true, vision: false, parallelToolCalls: true },
      contextWindow: 100_000,
    },
    stream(_input: LLMInput) {
      const chunks = steps[step] ?? [
        { type: "text-delta", textDelta: "done" },
        { type: "finish", finishReason: "stop" },
      ]
      step += 1
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
  }
}

const answer = (text: string): LLMChunk[] => [
  { type: "text-delta", textDelta: text },
  { type: "finish", finishReason: "stop" },
]

const toolCall = (toolName: string, args: unknown = {}, id = "call-1"): LLMChunk[] => [
  { type: "tool-call", toolCallId: id, toolName, args },
  { type: "finish", finishReason: "tool-calls" },
]

const echoTool = defineTool({
  id: "echo",
  description: "echoes",
  parameters: z.object({}),
  async execute() {
    return { output: "ok" }
  },
})

async function run(
  model: Model,
  options?: {
    tools?: typeof echoTool[]
    steps?: number
    format?: { type: "json_schema"; schema: Record<string, unknown> }
  },
) {
  const runtime = createTestRuntime()
  runtime.agent_registry.register(createAgent({
    name: "runner",
    model,
    tools: options?.tools ?? [],
    steps: options?.steps,
    middleware: baseMiddleware(),
    deps: runtime,
  }), { mode: "primary" })
  const session = await runPrompt({ runtime, agent: "runner", text: "go", format: options?.format })
  const assistants = runtime.sessions
    .get(session.id)
    .messages.filter((message): message is AssistantMessage => message.role === "assistant")
  return { runtime, session, assistants }
}

const SCHEMA = { type: "object", properties: { value: { type: "number" } } }

describe("runLoop step judgment", () => {
  it("breaks on final text and records the model finish", async () => {
    const { runtime, session, assistants } = await run(scripted([answer("hello")]))

    expect(assistants.length).toBe(1)
    expect(assistants[0].finish).toBe("stop")
    expect(assistants[0].error).toBeUndefined()
    expect(runtime.sessions.messageText(session.id, assistants[0].id)).toBe("hello")
  })

  it("continues after a tool-call step, then breaks on the answer", async () => {
    const { assistants } = await run(scripted([toolCall("echo"), answer("after tool")]), { tools: [echoTool] })

    expect(assistants.length).toBe(2)
    expect(assistants[0].finish).toBe("tool-calls")
    expect(assistants[1].finish).toBe("stop")
  })

  it("captures structured output on the final step", async () => {
    const { assistants } = await run(scripted([answer('{"value": 42}')]), { format: { type: "json_schema", schema: SCHEMA } })

    expect(assistants.length).toBe(1)
    expect(assistants[0].structured).toEqual({ value: 42 })
    expect(assistants[0].error).toBeUndefined()
  })

  it("does not parse structured output on an intermediate tool-call step", async () => {
    // A pure tool-call step has no final text; it must pass through unparsed and
    // the structured result must come from the closing step.
    const { assistants } = await run(scripted([toolCall("echo"), answer('{"value": 7}')]), {
      tools: [echoTool],
      format: { type: "json_schema", schema: SCHEMA },
    })

    expect(assistants.length).toBe(2)
    expect(assistants[0].error).toBeUndefined()
    expect(assistants[1].structured).toEqual({ value: 7 })
  })

  it("fails the step on invalid structured output", async () => {
    const { assistants } = await run(scripted([answer("not json")]), { format: { type: "json_schema", schema: SCHEMA } })

    expect(assistants.length).toBe(1)
    expect(assistants[0].error?.code).toBe("invalid_structured_output")
    expect(assistants[0].finish).toBe("error")
  })

  it("forces a stop when the step budget is exhausted mid-task", async () => {
    // One allowed step, but the model still wants tools: budget overrides the
    // recorded finish to "stop" and appends the stop note.
    const { runtime, session, assistants } = await run(scripted([toolCall("echo"), toolCall("echo"), answer("never")]), {
      tools: [echoTool],
      steps: 1,
    })

    expect(assistants.length).toBe(1)
    expect(assistants[0].finish).toBe("stop")
    expect(runtime.sessions.messageText(session.id, assistants[0].id)).toContain("[Stopped:")
  })

  it("stops the step when a doom loop of identical calls is detected", async () => {
    const sameCall = (id: string): LLMChunk[] => toolCall("echo", {}, id)
    const { runtime, session, assistants } = await run(
      scripted([sameCall("c1"), sameCall("c2"), sameCall("c3"), sameCall("c4"), answer("never")]),
      { tools: [echoTool], steps: 10 },
    )

    const last = assistants[assistants.length - 1]
    expect(last.error?.code).toBe("doom_loop")
    const parts = runtime.sessions
      .parts(session.id, last.id)
      .filter((part): part is ToolPart => part.type === "tool")
    // The part records the post-middleware truth: the denied call's error state.
    expect(parts[0]?.state.status).toBe("error")
  })
})

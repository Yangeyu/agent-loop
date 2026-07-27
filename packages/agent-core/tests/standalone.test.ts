// The acceptance test for the split: build a working agent out of this package
// and nothing else.
//
// It is not a demo. Every collaborator the loop used to hold — a workspace, a
// skill catalogue, an agent registry, a tool registry — would show up here as an
// import this file cannot make. If any of them were still required, this test
// would not compile, which is the only reliable way to know the core is clean.
import { describe, expect, it } from "bun:test"
import { z } from "zod"
import {
  createAgent,
  createFakeModel,
  defineTool,
  type LLMChunk,
  type LoopEvent,
  type MiddlewareFactory,
  type Model,
} from "@agent-core"

// A tool with no filesystem, no registry, and no ambient anything: it holds its
// one collaborator in a closure, which is the pattern the whole split rests on.
function createCounterTool(counter: { value: number }) {
  return defineTool({
    id: "increment",
    description: "Add a number to the running total.",
    parameters: z.object({ by: z.coerce.number() }),
    describe(args) {
      return { verb: "increment", target: String(args.by) }
    },
    async execute(args) {
      counter.value += args.by
      return { output: `total is now ${counter.value}` }
    },
  })
}

// One tool call, then a final answer.
function scriptedModel(): Model {
  const scripts: LLMChunk[][] = [
    [
      { type: "tool-call", toolCallId: "call-1", toolName: "increment", args: { by: 41 } },
      { type: "finish", finishReason: "tool-calls" },
    ],
    [
      { type: "text-delta", textDelta: "done" },
      { type: "finish", finishReason: "stop" },
    ],
  ]
  let call = 0
  const base = createFakeModel()
  return {
    ...base,
    stream() {
      const chunks = scripts[Math.min(call, scripts.length - 1)]
      call += 1
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
  }
}

describe("an agent built from agent-core alone", () => {
  it("runs a tool and reaches a final answer", async () => {
    const counter = { value: 1 }
    const agent = createAgent({
      name: "counter",
      model: scriptedModel(),
      instructions: ["You keep a running total."],
      tools: [createCounterTool(counter)],
      steps: 4,
    })

    const session = await agent.run({ text: "add 41" })

    expect(counter.value).toBe(42)
    const assistants = session.messages.filter((message) => message.role === "assistant")
    expect(assistants).toHaveLength(2)
    expect(agent.sessions.messageText(session.id, assistants[1].id)).toBe("done")
  })

  it("speaks its instructions without any middleware registered", async () => {
    const systems: string[][] = []
    const base = createFakeModel({ chunks: [{ type: "text-delta", textDelta: "ok" }, { type: "finish", finishReason: "stop" }] })
    const model: Model = {
      ...base,
      stream(input) {
        systems.push([...input.system])
        return base.stream(input)
      },
    }

    await createAgent({ model, instructions: ["IDENTITY"], steps: 1 }).run({ text: "hi" })

    expect(systems[0]).toEqual(["IDENTITY"])
  })

  it("lets a middleware report activity on the loop channel", async () => {
    // The extension point in miniature: a middleware the core has never heard of
    // both wraps the model call and tells the outside what it is doing.
    const announce: MiddlewareFactory = () => ({
      name: "announce",
      async wrapModelCall(ctx, request, next) {
        const activity = ctx.activity({ label: "thinking about it", detail: `step ${ctx.step}` })
        try {
          return await next(request)
        } finally {
          activity.end("done thinking")
        }
      },
    })

    const agent = createAgent({
      model: createFakeModel({ chunks: [{ type: "text-delta", textDelta: "ok" }, { type: "finish", finishReason: "stop" }] }),
      middleware: [announce],
      steps: 1,
    })

    const seen: LoopEvent[] = []
    agent.events.loop.subscribe((event) => {
      if (event.type === "turn.activity") seen.push(event)
    })

    await agent.run({ text: "hi" })

    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ source: "announce", status: "start", label: "thinking about it", detail: "step 1" })
    expect(seen[1]).toMatchObject({ source: "announce", status: "end", detail: "done thinking" })
  })
})

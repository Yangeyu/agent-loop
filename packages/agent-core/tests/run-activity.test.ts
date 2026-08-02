import { describe, expect, it } from "bun:test"
import { createAgent, createEngineDeps } from "@agent-core"
import type { LLMChunk, LLMInput, LoopEvent, Model } from "@agent-core"

function answerModel(): Model {
  return {
    providerID: "fake",
    spec: {
      id: "fake-model",
      capabilities: { tools: true, reasoning: false, structuredOutput: false, streaming: true, vision: false, parallelToolCalls: true },
      contextWindow: 100_000,
    },
    stream(_input: LLMInput) {
      const chunks: LLMChunk[] = [
        { type: "text-delta", textDelta: "done" },
        { type: "finish", finishReason: "stop" },
      ]
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
  }
}

describe("run-scoped activity", () => {
  it("binds the middleware name and carries no messageID at run boundaries", async () => {
    const deps = createEngineDeps()
    const events: LoopEvent[] = []
    deps.events.loop.subscribe((event) => events.push(event))

    const agent = createAgent({
      model: answerModel(),
      deps,
      middleware: [
        () => ({
          name: "teardown-probe",
          async afterRun(ctx) {
            ctx.activity({ label: "flushing" }).end("flushed")
          },
        }),
      ],
    })
    await agent.run({ text: "go" })

    const activities = events.filter((event) => event.type === "step.activity")
    expect(activities.map((event) => event.status)).toEqual(["start", "end"])
    for (const activity of activities) {
      expect(activity.source).toBe("teardown-probe")
      // Run-boundary activities have no step to attach to.
      expect(activity.messageID).toBeUndefined()
    }
  })

  it("keeps step-scoped activities attached to their step", async () => {
    const deps = createEngineDeps()
    const events: LoopEvent[] = []
    deps.events.loop.subscribe((event) => events.push(event))

    const agent = createAgent({
      model: answerModel(),
      deps,
      middleware: [
        () => ({
          name: "step-probe",
          async beforeStep(ctx) {
            ctx.activity({ label: "checking" }).end()
            return { proceed: true }
          },
        }),
      ],
    })
    await agent.run({ text: "go" })

    const activities = events.filter((event) => event.type === "step.activity")
    expect(activities.length).toBeGreaterThan(0)
    for (const activity of activities) {
      expect(activity.messageID).toBeDefined()
    }
  })
})

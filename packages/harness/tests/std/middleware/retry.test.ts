// Retry as a middleware, asserted end to end through the wrapModelCall onion.
// Two things are under test that were previously untestable: that a failed
// stream is re-issued at all, and that each attempt is *visible* — before this,
// a backoff was indistinguishable from a hung turn on any surface.
import { describe, expect, it } from "bun:test"
import { defineHarnessAgent } from "@harness/agent/registry"
import {
  createRetry,
  createTestRuntime,
  runPrompt,
  type LoopEvent,
} from "@harness"
import type { LLMChunk, Model } from "@harness/llm/types"
import { createFakeModel } from "../../support/fake-model"

const DONE: LLMChunk[] = [
  { type: "text-delta", textDelta: "ok" },
  { type: "finish", finishReason: "stop" },
]

// A model whose first `failures` calls throw mid-stream, after which it finishes.
function flakyModel(failures: number, error: () => Error) {
  let calls = 0
  const base = createFakeModel()
  const model: Model = {
    ...base,
    stream() {
      const attempt = (calls += 1)
      return {
        fullStream: (async function* () {
          if (attempt <= failures) throw error()
          for (const chunk of DONE) yield chunk
        })(),
      }
    },
  }
  return { model, calls: () => calls }
}

function run(model: Model, maxRetries: number) {
  const agent = defineHarnessAgent({
    name: "retrier",
    mode: "primary",
    model,
    steps: 1,
    middleware: [createRetry({ maxRetries, baseDelayMs: 1, maxDelayMs: 1 })],
  })
  const runtime = createTestRuntime({ agents: [agent] })

  const activity: LoopEvent[] = []
  runtime.events.loop.subscribe((event) => {
    if (event.type === "turn.activity") activity.push(event)
  })

  return { runtime, activity, finish: () => runPrompt({ runtime, text: "go", agent: agent.name }) }
}

describe("createRetry", () => {
  it("re-issues a retryable stream failure and lets the turn finish", async () => {
    const flaky = flakyModel(2, () => new Error("rate limit exceeded"))
    const { activity, finish } = run(flaky.model, 2)

    const session = await finish()

    expect(flaky.calls()).toBe(3)
    const assistant = session.messages.find((message) => message.role === "assistant")
    expect(assistant?.error).toBeUndefined()
    expect(activity.map((event) => event.type === "turn.activity" && event.status)).toEqual([
      "start",
      "end",
      "start",
      "end",
    ])
  })

  it("names itself as the activity source without being told to", async () => {
    const flaky = flakyModel(1, () => new Error("socket hang up"))
    const { activity, finish } = run(flaky.model, 2)

    await finish()

    // The middleware calls ctx.activity({ label, detail }); the stack supplies
    // `source` from middleware.name, so a producer can never mislabel itself.
    expect(activity[0]).toMatchObject({
      type: "turn.activity",
      source: "retry",
      label: "retrying model call",
      detail: "attempt 1 of 2",
    })
  })

  it("gives up immediately on an error it cannot classify as transient", async () => {
    const flaky = flakyModel(1, () => new Error("invalid api key"))
    const { activity, finish } = run(flaky.model, 2)

    const session = await finish()

    expect(flaky.calls()).toBe(1)
    expect(activity).toEqual([])
    const assistant = session.messages.find((message) => message.role === "assistant")
    expect(assistant?.error?.message).toBe("invalid api key")
  })

  it("stops after the configured number of attempts", async () => {
    const flaky = flakyModel(99, () => new Error("503 service unavailable"))
    const { finish } = run(flaky.model, 2)

    const session = await finish()

    expect(flaky.calls()).toBe(3)
    const assistant = session.messages.find((message) => message.role === "assistant")
    expect(assistant?.error?.retryable).toBe(true)
  })
})

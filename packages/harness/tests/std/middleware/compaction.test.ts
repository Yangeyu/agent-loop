import { describe, expect, it } from "bun:test"
import { baseMiddleware, createTestRuntime, defineAgent, runPrompt, type Config } from "@harness"
import { createCompaction, resolveCutBoundary } from "@harness/std/middleware/compaction"
import type { LLMChunk } from "@harness/llm/types"
import type { SessionMessage } from "@harness/types"
import { createFakeModel } from "../../support/fake-model"

const ANSWER_SCRIPT: LLMChunk[] = [
  { type: "text-delta", textDelta: "done" },
  { type: "finish", finishReason: "stop" },
]

// A primary agent whose main model and (injected) summarizer model are both fakes,
// so compaction runs deterministically and we can observe whether the dedicated
// summarizer — not the main model — produced the summary.
async function buildRuntime(config?: Partial<Config>) {
  const summarizerCalls: string[] = []
  const summarizer = createFakeModel({
    chunks: ANSWER_SCRIPT,
    spec: { id: "qwen3.6-flash" },
    onStream: () => summarizerCalls.push("qwen3.6-flash"),
  })
  const agent = defineAgent({
    name: "lead",
    mode: "primary",
    model: createFakeModel({ chunks: ANSWER_SCRIPT, spec: { id: "qwen3.7-plus", contextWindow: 262144 } }),
    middleware: [...baseMiddleware(), createCompaction({ summarizer })],
  })
  const runtime = await createTestRuntime({ agents: [agent], config })
  return { runtime, summarizerCalls }
}

function msg(role: SessionMessage["role"]): SessionMessage {
  return { role } as SessionMessage
}

describe("resolveCutBoundary", () => {
  it("snaps the cut to the next user message after the retained half", () => {
    const messages = [msg("user"), msg("assistant"), msg("user"), msg("assistant")]
    expect(resolveCutBoundary(messages, 0.5)).toBe(2)
  })

  it("returns undefined when the only user message is at index 0 (no boundary to snap to)", () => {
    const messages = [msg("user"), msg("assistant"), msg("assistant"), msg("assistant")]
    expect(resolveCutBoundary(messages, 0.5)).toBeUndefined()
  })

  it("returns undefined when there is no older half to summarize", () => {
    const messages = [msg("user"), msg("assistant")]
    expect(resolveCutBoundary(messages, 0.9)).toBeUndefined()
  })
})

describe("compaction middleware (integration)", () => {
  it("does not compact when the estimate stays below the window ratio", async () => {
    const { runtime, summarizerCalls } = await buildRuntime()

    const compactions: unknown[] = []
    runtime.events.state.subscribe((event) => {
      if (event.type === "history.replaced") compactions.push(event)
    })

    const first = await runPrompt({ runtime, agent: "lead", text: "first question" })
    const second = await runPrompt({ runtime, agent: "lead", sessionID: first.id, text: "second question" })

    expect(compactions).toHaveLength(0)
    expect(summarizerCalls).toHaveLength(0)
    expect(second.messages.length).toBe(4) // user1, assistant1, user2, assistant2 — all retained
  })

  it("keeps the recent half and replaces the older half with a summary when over threshold", async () => {
    // Force the trigger: threshold = contextWindow × ratio ≈ a few tokens.
    const { runtime, summarizerCalls } = await buildRuntime({
      compaction_trigger_ratio: 0.00001,
      compaction_retain_ratio: 0.5,
    })

    const compactions: { parts: Record<string, readonly unknown[]> }[] = []
    runtime.events.state.subscribe((event) => {
      if (event.type === "history.replaced") compactions.push({ parts: event.parts })
    })

    const first = await runPrompt({ runtime, agent: "lead", text: "first question" })
    const second = await runPrompt({ runtime, agent: "lead", sessionID: first.id, text: "second question" })

    // Older half (user1 + assistant1) collapsed; only the recent user/assistant remain.
    expect(second.messages.length).toBe(2)
    const boundary = second.messages[0]
    expect(boundary.role).toBe("user")

    // Summary is prepended to the kept window's first user message.
    const boundaryParts = second.parts[boundary.id]
    expect(boundaryParts[0].type).toBe("compaction")

    // A history.replaced state event fired exactly once, carrying the new state.
    expect(compactions).toHaveLength(1)
    expect(compactions[0].parts[boundary.id]?.[0]).toMatchObject({ type: "compaction" })

    // The summary ran on the dedicated summarizer model, not the main model.
    expect(summarizerCalls).toEqual(["qwen3.6-flash"])
  })
})

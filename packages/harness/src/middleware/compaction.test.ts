import { describe, expect, it } from "bun:test"
import { createTestRuntime, runPrompt } from "@harness"
import { corePlugin } from "@harness/module"
import { resolveCutBoundary } from "@harness/middleware/compaction"
import type { ModelProvider } from "@harness/agent/model"
import type { LLMChunk } from "@harness/llm/types"
import type { SessionMessage } from "@harness/types"

// Records the model id of every provider call and replays a fixed script per call.
function recordingProvider(chunks: LLMChunk[]): { provider: ModelProvider; modelIDs: string[] } {
  const modelIDs: string[] = []
  const provider: ModelProvider = (input) => {
    modelIDs.push(input.user.model.modelID)
    return {
      fullStream: (async function* () {
        for (const chunk of chunks) yield chunk
      })(),
    }
  }
  return { provider, modelIDs }
}

const ANSWER_SCRIPT: LLMChunk[] = [
  { type: "text-delta", textDelta: "done" },
  { type: "finish", finishReason: "stop" },
]

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
    const { provider } = recordingProvider(ANSWER_SCRIPT)
    const runtime = await createTestRuntime({ plugins: [corePlugin], model_provider: provider })

    const compactions: unknown[] = []
    runtime.events.subscribe((event) => {
      if (event.type === "compaction") compactions.push(event)
    })

    const first = await runPrompt({ runtime, agent: "lead", text: "first question" })
    const second = await runPrompt({ runtime, agent: "lead", sessionID: first.id, text: "second question" })

    expect(compactions).toHaveLength(0)
    expect(second.messages.length).toBe(4) // user1, assistant1, user2, assistant2 — all retained
  })

  it("keeps the recent half and replaces the older half with a summary when over threshold", async () => {
    const { provider, modelIDs } = recordingProvider(ANSWER_SCRIPT)
    const runtime = await createTestRuntime({
      plugins: [corePlugin],
      model_provider: provider,
      // Force the trigger: threshold = contextWindow × ratio ≈ a few tokens.
      config: { compaction_trigger_ratio: 0.00001, compaction_retain_ratio: 0.5 },
    })

    const compactions: { summary: string }[] = []
    runtime.events.subscribe((event) => {
      if (event.type === "compaction") compactions.push(event)
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

    // A compaction event fired exactly once.
    expect(compactions).toHaveLength(1)
    expect(compactions[0].summary.length).toBeGreaterThan(0)

    // The summarizer ran on the dedicated compaction model, not the lead model.
    expect(modelIDs).toContain("qwen3.5-flash")
  })
})

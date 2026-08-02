import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LLMChunk, LLMInput, Model } from "@agent-core"
import { createCoreTestRuntime, runPrompt } from "@harness"
import { FileMemoryStore } from "@harness/memory/file-store"
import type { MemoryRecord } from "@harness/memory/types"

function tempDir() {
  return mkdtempSync(join(tmpdir(), "memory-extraction-"))
}

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

const CANDIDATE = {
  name: "prefers-tabs",
  description: "User prefers tabs over spaces",
  type: "feedback",
  body: "Use tabs.\n\n**Why:** stated preference.\n\n**How to apply:** indent with tabs.",
}

function seeded(dir: string, overrides?: Partial<MemoryRecord>): FileMemoryStore {
  const store = new FileMemoryStore(dir)
  store.upsert({
    name: "prefers-tabs",
    description: "User prefers tabs over spaces",
    type: "feedback",
    scope: "workspace",
    origin: "extracted",
    sources: ["ses_old"],
    body: "Use tabs.",
    ...overrides,
  })
  return store
}

// Runs one lead session whose chat model just answers; the extractor's
// scripted replies drive the consolidation path under test.
async function settle(memoryDir: string, extractorReplies: string[]) {
  const runtime = createCoreTestRuntime({
    chat: scripted([answer("done")]),
    summarizer: scripted(extractorReplies.map((reply) => answer(reply))),
    config: { memory_dir: memoryDir },
  })
  const session = await runPrompt({ runtime, text: "no, use tabs — always" })
  return { runtime, session }
}

describe("memory extraction at settle", () => {
  it("saves a feedback candidate with extracted origin and the session as source", async () => {
    const dir = tempDir()
    const { runtime, session } = await settle(dir, [JSON.stringify([CANDIDATE])])

    const saved = runtime.memory.read("prefers-tabs")
    expect(saved?.origin).toBe("extracted")
    expect(saved?.sources).toEqual([session.id])
    expect(saved?.body).toContain("**How to apply:**")
  })

  it("discards unparseable extractor output without touching the run", async () => {
    const dir = tempDir()
    const { runtime, session } = await settle(dir, ["I could not find anything."])

    expect(runtime.memory.recall()).toEqual([])
    // The run itself settled normally — a memory failure never fails the run.
    expect(runtime.sessions.get(session.id).messages.some((message) => message.role === "assistant")).toBe(true)
  })

  it("admits only feedback candidates in this phase", async () => {
    const dir = tempDir()
    const { runtime } = await settle(dir, [
      JSON.stringify([{ ...CANDIDATE, name: "project-goal", type: "project" }]),
    ])

    expect(runtime.memory.recall()).toEqual([])
  })

  it("folds an update into the existing record, accumulating the source chain", async () => {
    const dir = tempDir()
    seeded(dir)
    const revision = { description: "User prefers tabs, hard requirement", body: "Always use tabs." }
    const { runtime, session } = await settle(dir, [
      JSON.stringify([{ ...CANDIDATE, name: "tabs-always" }]),
      JSON.stringify({ action: "update", target: "prefers-tabs", revision, reason: "same fact slot" }),
    ])

    const updated = runtime.memory.read("prefers-tabs")
    expect(updated?.body).toBe("Always use tabs.")
    expect(updated?.sources).toEqual(["ses_old", session.id])
    expect(runtime.memory.read("tabs-always")).toBeNull()
  })

  it("supersedes an extracted record: successor live, target archived", async () => {
    const dir = tempDir()
    seeded(dir)
    const { runtime } = await settle(dir, [
      JSON.stringify([{ ...CANDIDATE, name: "prefers-spaces", description: "User prefers spaces", body: "Spaces now." }]),
      JSON.stringify({ action: "supersede", target: "prefers-tabs", reason: "contradicts" }),
    ])

    expect(runtime.memory.read("prefers-tabs")).toBeNull()
    expect(runtime.memory.read("prefers-spaces")?.origin).toBe("extracted")
  })

  it("still extracts when the run crashes — afterRun runs in a finally", async () => {
    const dir = tempDir()
    const broken: Model = {
      ...scripted([]),
      stream() {
        throw new Error("model exploded")
      },
    }
    const runtime = createCoreTestRuntime({
      chat: broken,
      summarizer: scripted([answer(JSON.stringify([CANDIDATE]))]),
      config: { memory_dir: dir, model_max_retries: 0 },
    })

    // However the run ends — settled error or thrown — the feedback survives.
    await runPrompt({ runtime, text: "no, use tabs — always" }).catch(() => {})
    expect(runtime.memory.read("prefers-tabs")?.origin).toBe("extracted")
  })

  it("cannot overwrite an explicit record — the contradiction becomes a dispute mark", async () => {
    const dir = tempDir()
    seeded(dir, { origin: "explicit" })
    const { runtime, session } = await settle(dir, [
      JSON.stringify([{ ...CANDIDATE, name: "prefers-spaces", description: "User prefers spaces", body: "Spaces now." }]),
      JSON.stringify({ action: "supersede", target: "prefers-tabs", reason: "contradicts" }),
    ])

    const kept = runtime.memory.read("prefers-tabs")
    expect(kept?.body).toBe("Use tabs.")
    expect(kept?.disputed).toEqual([session.id])
    expect(runtime.memory.read("prefers-spaces")).toBeNull()
  })
})

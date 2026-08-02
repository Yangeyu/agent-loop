import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createToolContext } from "@agent-core"
import type { LLMChunk, LLMInput, Model } from "@agent-core"
import { createCoreTestRuntime, runPrompt } from "@harness"
import { FileMemoryStore } from "@harness/memory/file-store"
import { createMemoryForgetTool, createMemoryReadTool, createMemorySaveTool } from "@harness/tools/memory"

function tempDir() {
  return mkdtempSync(join(tmpdir(), "memory-"))
}

const SAVE_ARGS = {
  name: "prefers-tabs",
  description: "User prefers tabs over spaces",
  type: "feedback",
  body: "Use tabs.\n\n**Why:** stated preference.",
} as const

describe("memory tools", () => {
  it("saves with explicit origin, then accumulates the source chain on update", async () => {
    const memory = new FileMemoryStore(tempDir())
    const save = createMemorySaveTool({ memory })

    await save.execute(SAVE_ARGS, createToolContext({ sessionID: "ses_a" }))
    const result = await save.execute({ ...SAVE_ARGS, body: "Use tabs, always." }, createToolContext({ sessionID: "ses_b" }))

    expect(result.output).toContain("Updated")
    const saved = memory.read("prefers-tabs")
    expect(saved?.origin).toBe("explicit")
    expect(saved?.sources).toEqual(["ses_a", "ses_b"])
    expect(saved?.body).toBe("Use tabs, always.")
  })

  it("reads a record back and fails on unknown names with the live list", async () => {
    const memory = new FileMemoryStore(tempDir())
    await createMemorySaveTool({ memory }).execute(SAVE_ARGS, createToolContext())

    const read = createMemoryReadTool({ memory })
    const result = await read.execute({ name: "prefers-tabs" }, createToolContext())
    expect(result.output).toContain("Use tabs.")

    expect(read.execute({ name: "ghost-fact" }, createToolContext())).rejects.toThrow(/prefers-tabs/)
  })

  it("forgets by archiving, and save can supersede in the same step", async () => {
    const memory = new FileMemoryStore(tempDir())
    const save = createMemorySaveTool({ memory })
    await save.execute(SAVE_ARGS, createToolContext())
    await save.execute(
      { ...SAVE_ARGS, name: "prefers-spaces", body: "Spaces after all.", supersedes: ["prefers-tabs"] },
      createToolContext(),
    )
    expect(memory.read("prefers-tabs")).toBeNull()

    await createMemoryForgetTool({ memory }).execute({ name: "prefers-spaces", reason: "falsified" }, createToolContext())
    expect(memory.recall()).toEqual([])
  })
})

// A model that replays one scripted chunk list per step and records every
// input it was called with, so a test can assert on the rendered system prompt.
function scripted(steps: LLMChunk[][], inputs?: LLMInput[]): Model {
  let step = 0
  return {
    providerID: "fake",
    spec: {
      id: "fake-model",
      capabilities: { tools: true, reasoning: false, structuredOutput: false, streaming: true, vision: false, parallelToolCalls: true },
      contextWindow: 100_000,
    },
    stream(input: LLMInput) {
      inputs?.push(input)
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

// The acceptance test for the whole capability: a fact saved in one session
// must reach the next session's system prompt through a cold recall.
describe("memory across sessions", () => {
  it("carries a saved fact into a fresh runtime's system prompt", async () => {
    const memoryDir = join(tempDir(), "store")

    // Session A: the lead saves a memory, then answers.
    const sessionA = scripted([
      [
        { type: "tool-call", toolCallId: "call-1", toolName: "memory_save", args: SAVE_ARGS },
        { type: "finish", finishReason: "tool-calls" },
      ],
      answer("noted"),
    ])
    const runtimeA = createCoreTestRuntime({
      chat: sessionA,
      summarizer: scripted([]),
      config: { memory_dir: memoryDir },
    })
    await runPrompt({ runtime: runtimeA, text: "remember: I prefer tabs" })
    expect(runtimeA.memory.read("prefers-tabs")?.description).toBe(SAVE_ARGS.description)

    // Session B: a fresh runtime over the same directory — nothing shared in
    // memory, only the files.
    const inputs: LLMInput[] = []
    const runtimeB = createCoreTestRuntime({
      chat: scripted([answer("hello")], inputs),
      summarizer: scripted([]),
      config: { memory_dir: memoryDir },
    })
    await runPrompt({ runtime: runtimeB, text: "hi" })

    const system = inputs[0].system.join("\n")
    expect(system).toContain("<memories>")
    expect(system).toContain("- prefers-tabs [feedback] User prefers tabs over spaces")
  })

  it("states the curation rules even while the store is empty", async () => {
    const inputs: LLMInput[] = []
    const runtime = createCoreTestRuntime({
      chat: scripted([answer("hi")], inputs),
      summarizer: scripted([]),
      config: { memory_dir: join(tempDir(), "store") },
    })
    await runPrompt({ runtime, text: "hi" })

    const system = inputs[0].system.join("\n")
    expect(system).toContain("memory_save")
    expect(system).toContain("currently empty")
  })
})

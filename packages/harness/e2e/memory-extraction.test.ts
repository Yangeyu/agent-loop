import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LLMChunk, LLMInput, LoopEvent, Model } from "@agent-core"
import { createCoreTestRuntime, runPrompt } from "@harness"
import { FileMemoryStore } from "@harness/memory/file-store"
import type { MemoryRecord } from "@harness/memory/types"
import { createDashScopeModel } from "@providers"

// End-to-end against the real extractor model — the same cheap model the
// composition root hands the lead (see apps/cli/src/compose.ts). The chat side
// stays scripted: the conversation is the fixture, extraction quality is the
// thing under test. Skipped when no API key is present.
const live = it.skipIf(!process.env.DASHSCOPE_API_KEY)
const EXTRACTOR_MODEL_ID = "qwen3.6-flash"

function scripted(reply: string): Model {
  return {
    providerID: "fake",
    spec: {
      id: "fake-model",
      capabilities: { tools: true, reasoning: false, structuredOutput: false, streaming: true, vision: false, parallelToolCalls: true },
      contextWindow: 100_000,
    },
    stream(_input: LLMInput) {
      const chunks: LLMChunk[] = [
        { type: "text-delta", textDelta: reply },
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

// One settle pass: a single-run conversation (user turn + scripted assistant
// ack — the shape a cross-session correction actually has), extracted by the
// real model. Activity ends are printed so a failing run shows why.
async function settle(input: { userText: string; assistantReply: string; memoryDir: string }) {
  const runtime = createCoreTestRuntime({
    chat: scripted(input.assistantReply),
    summarizer: createDashScopeModel({ modelID: EXTRACTOR_MODEL_ID }),
    config: { memory_dir: input.memoryDir },
  })
  runtime.events.loop.subscribe((event: LoopEvent) => {
    if (event.type === "step.activity" && event.status === "end") {
      console.log(`[activity] ${event.source}: ${event.detail ?? event.label}`)
    }
  })
  await runPrompt({ runtime, text: input.userText })
  const live = runtime.memory.recall().map((entry) => runtime.memory.read(entry.name))
  console.log(`[records] ${JSON.stringify(live, null, 2)}`)
  return { runtime, records: live as MemoryRecord[] }
}

function seedFeedback(dir: string, record: Pick<MemoryRecord, "name" | "description" | "body">) {
  new FileMemoryStore(dir).upsert({
    ...record,
    type: "feedback",
    scope: "workspace",
    origin: "extracted",
    sources: ["ses_seed"],
  })
}

describe("memory extraction quality (e2e)", () => {
  live(
    "extracts a durable feedback memory from an explicit correction",
    async () => {
      const { records } = await settle({
        memoryDir: mkdtempSync(join(tmpdir(), "mem-e2e-")),
        userText:
          "Last time you generated the report by appending section after section. Don't ever do that again — " +
          "always write the full document skeleton first with placeholder markers, then edit each placeholder one by one. " +
          "Appending is blind: when a middle section fails, the whole file ends up corrupted.",
        assistantReply: "Understood — I will write the full skeleton first, then fill each placeholder with targeted edits.",
      })

      expect(records.length).toBeGreaterThanOrEqual(1)
      for (const record of records) {
        expect(record.type).toBe("feedback")
        expect(record.origin).toBe("extracted")
      }
      // The fact itself must survive in substance, whatever slug the model picked.
      expect(JSON.stringify(records)).toMatch(/skeleton|placeholder|append/i)
    },
    120_000,
  )

  live(
    "extracts nothing from a session with no durable feedback",
    async () => {
      const { records } = await settle({
        memoryDir: mkdtempSync(join(tmpdir(), "mem-e2e-")),
        userText: "What does HTTP status 418 mean? Just curious.",
        assistantReply: "418 is \"I'm a teapot\", an April Fools joke from RFC 2324.",
      })

      expect(records).toEqual([])
    },
    120_000,
  )

  live(
    "restating a known preference does not create a duplicate record",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "mem-e2e-"))
      seedFeedback(dir, {
        name: "write-skeleton-then-edit",
        description: "Long documents: write the full skeleton first, then edit placeholders",
        body: "Never build a long document by appending sections. Write the complete skeleton with placeholders, then fill each with a targeted edit.\n\n**Why:** appending is blind; a failed middle section corrupts the file.\n\n**How to apply:** write once with markers, then edit marker by marker.",
      })

      const { records } = await settle({
        memoryDir: dir,
        userText:
          "Remember: for long documents I want the skeleton written first and the sections filled in by editing placeholders, not appended one after another.",
        assistantReply: "Yes — skeleton first, then targeted edits per placeholder.",
      })

      // Update or drop are both acceptable; a second record for the same fact is not.
      expect(records.length).toBe(1)
      expect(records[0].name).toBe("write-skeleton-then-edit")
    },
    120_000,
  )

  live(
    "a reversed preference replaces the old record instead of coexisting with it",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "mem-e2e-"))
      seedFeedback(dir, {
        name: "verbose-code-comments",
        description: "User wants detailed comments on every function",
        body: "Write detailed explanatory comments on every function.\n\n**Why:** stated preference.\n\n**How to apply:** comment each function thoroughly.",
      })

      const { records } = await settle({
        memoryDir: dir,
        userText:
          "I know I told you before to write detailed comments on every function — I've changed my mind. " +
          "Keep comments minimal from now on: only document non-obvious constraints, nothing else.",
        assistantReply: "Got it — minimal comments only, reserved for non-obvious constraints.",
      })

      const rendered = JSON.stringify(records)
      // The live truth must be the new preference; the old one may be archived
      // (supersede) or rewritten in place (update), but must not survive as-is.
      expect(rendered).toMatch(/minimal|non-obvious/i)
      const stale = records.find(
        (record) => record.name === "verbose-code-comments" && /detailed comments on every function/i.test(record.body),
      )
      expect(stale).toBeUndefined()
    },
    120_000,
  )
})

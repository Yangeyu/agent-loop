import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileMemoryStore } from "@harness/memory/file-store"
import type { MemoryRecord } from "@harness/memory/types"

function tempDir() {
  return mkdtempSync(join(tmpdir(), "memory-store-"))
}

function record(overrides?: Partial<MemoryRecord>): MemoryRecord {
  return {
    name: "prefers-tabs",
    description: "User prefers tabs over spaces",
    type: "feedback",
    scope: "workspace",
    origin: "explicit",
    sources: ["ses_1"],
    body: "Use tabs.\n\n**Why:** stated preference.",
    ...overrides,
  }
}

describe("FileMemoryStore", () => {
  it("round-trips a record through disk, optional fields included", async () => {
    const dir = tempDir()
    const saved = record({ links: ["other-fact"], disputed: ["ses_9"] })
    new FileMemoryStore(dir).upsert(saved)

    // A fresh instance must reconstruct the record from the file alone.
    expect(new FileMemoryStore(dir).read("prefers-tabs")).toEqual(saved)
  })

  it("recalls a sorted index and filters by type", async () => {
    const dir = tempDir()
    const store = new FileMemoryStore(dir)
    store.upsert(record({ name: "zeta-goal", type: "project" }))
    store.upsert(record({ name: "alpha-pref" }))

    expect(store.recall().map((entry) => entry.name)).toEqual(["alpha-pref", "zeta-goal"])
    expect(store.recall({ types: ["project"] }).map((entry) => entry.name)).toEqual(["zeta-goal"])
    // The index entry is the slice, never the body.
    expect(Object.keys(store.recall()[0]).sort()).toEqual(["description", "name", "scope", "type"])
  })

  it("treats a missing directory as empty and an unknown name as null", async () => {
    const store = new FileMemoryStore(join(tempDir(), "never-created"))
    expect(store.recall()).toEqual([])
    expect(store.read("anything")).toBeNull()
  })

  it("archives a superseded record in the same upsert, stamped with its successor", async () => {
    const dir = tempDir()
    const store = new FileMemoryStore(dir)
    store.upsert(record({ name: "old-fact" }))
    store.upsert(record({ name: "new-fact" }), { supersedes: ["old-fact"] })

    expect(store.read("old-fact")).toBeNull()
    expect(store.recall().map((entry) => entry.name)).toEqual(["new-fact"])
    const archived = readFileSync(join(dir, "archive", "old-fact.md"), "utf8")
    expect(archived).toContain('archived_reason: "superseded"')
    expect(archived).toContain('superseded_by: "new-fact"')
    expect(existsSync(join(dir, "old-fact.md"))).toBe(false)
  })

  it("rejects superseding an unknown record or itself", async () => {
    const store = new FileMemoryStore(tempDir())
    expect(() => store.upsert(record(), { supersedes: ["ghost"] })).toThrow(/no live memory record/)
    expect(() => store.upsert(record(), { supersedes: ["prefers-tabs"] })).toThrow(/cannot supersede itself/)
  })

  it("removes by archiving under the given reason, and refuses unknown names", async () => {
    const dir = tempDir()
    const store = new FileMemoryStore(dir)
    store.upsert(record())
    store.remove("prefers-tabs", "falsified")

    expect(store.read("prefers-tabs")).toBeNull()
    expect(readFileSync(join(dir, "archive", "prefers-tabs.md"), "utf8")).toContain('archived_reason: "falsified"')
    expect(() => store.remove("prefers-tabs", "expired")).toThrow(/no live memory record/)
  })

  it("fails loudly on a corrupt record file instead of reporting it absent", async () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "broken.md"), "no frontmatter here")

    expect(() => new FileMemoryStore(dir).recall()).toThrow(/Corrupt memory record/)
  })

  it("rejects a name that is not a plain kebab-case slug", async () => {
    // The name derives the file path; the pattern is the traversal guard.
    expect(() => new FileMemoryStore(tempDir()).upsert(record({ name: "../evil" }))).toThrow()
  })
})

import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWorkspace } from "@harness/workspace"

function createRoot() {
  return mkdtempSync(join(tmpdir(), "workspace-"))
}

describe("workspace paths", () => {
  it("resolves relative paths against its own root, not the process directory", () => {
    const root = createRoot()
    const workspace = createWorkspace(root)

    expect(workspace.resolve("docs/report.md")).toBe(join(root, "docs/report.md"))
    expect(workspace.relative(join(root, "docs/report.md"))).toBe("docs/report.md")
  })

  it("lets an absolute path through unchanged", () => {
    const workspace = createWorkspace(createRoot())

    expect(workspace.resolve("/etc/hosts")).toBe("/etc/hosts")
  })
})

describe("workspace writes", () => {
  it("creates parent directories and reports the result", async () => {
    const workspace = createWorkspace(createRoot())
    const target = workspace.resolve("nested/deep/report.html")

    const result = await workspace.write(target, "<!doctype html>")

    expect(readFileSync(target, "utf8")).toBe("<!doctype html>")
    expect(result).toEqual({ created: true, bytes: 15 })
  })

  it("replaces the previous contents rather than adding to them", async () => {
    const workspace = createWorkspace(createRoot())
    const target = workspace.resolve("report.html")

    await workspace.write(target, "<head>")
    const second = await workspace.write(target, "<body>")

    expect(readFileSync(target, "utf8")).toBe("<body>")
    expect(second).toEqual({ created: false, bytes: 6 })
  })

  it("never exposes a half-written file to a concurrent reader", async () => {
    // An overwrite is published by rename, so a reader sees the whole old file or
    // the whole new one. Large enough that a non-atomic write would take several
    // syscalls, giving any reader a torn view to catch.
    const workspace = createWorkspace(createRoot())
    const target = workspace.resolve("big.txt")
    const before = "a".repeat(400_000)
    const after = "b".repeat(700_000)
    await workspace.write(target, before)

    const writing = workspace.write(target, after)
    const reads = await Promise.all(Array.from({ length: 50 }, () => workspace.readText(target)))
    await writing

    for (const text of reads) {
      // Whole-file or nothing: any other length is a torn read.
      expect([before.length, after.length]).toContain(text.length)
      expect(text).toBe(text[0]!.repeat(text.length))
    }
  })

  it("refuses to treat a directory as a file", async () => {
    const workspace = createWorkspace(createRoot())
    const target = workspace.resolve("adir")
    mkdirSync(target)

    await expect(workspace.write(target, "x")).rejects.toMatchObject({ code: "EISDIR" })
  })
})

describe("workspace mutations", () => {
  it("does not lose an update when two mutations race on one file", async () => {
    // The failure this exists to prevent: two edits both read the original, and
    // whichever writes second erases the other's change. Serializing per path
    // makes the second mutation observe the first one's result.
    const workspace = createWorkspace(createRoot())
    const target = workspace.resolve("greet.ts")
    await workspace.write(target, "hello\nbye\n")

    const replace = (from: string, to: string) =>
      workspace.mutate(target, (current) => ({ text: current.replace(from, to), result: current }))

    await Promise.all([replace("hello", "hi"), replace("bye", "goodbye")])

    expect(readFileSync(target, "utf8")).toBe("hi\ngoodbye\n")
  })

  it("interleaves mutations on different files", async () => {
    // Exclusion is per path, not global: two files make progress at once.
    const workspace = createWorkspace(createRoot())
    const first = workspace.resolve("a.txt")
    const second = workspace.resolve("b.txt")
    await Promise.all([workspace.write(first, "a"), workspace.write(second, "b")])

    let inFlight = 0
    let peak = 0
    const slowAppend = (target: string) =>
      workspace.mutate(target, async (current) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 20))
        inFlight -= 1
        return { text: `${current}!`, result: undefined }
      })

    await Promise.all([slowAppend(first), slowAppend(second)])

    expect(peak).toBe(2)
  })

  it("leaves the file untouched when the change function throws", async () => {
    const workspace = createWorkspace(createRoot())
    const target = workspace.resolve("greet.ts")
    await workspace.write(target, "original")

    const attempt = workspace.mutate(target, () => {
      throw new Error("no match")
    })

    await expect(attempt).rejects.toThrow("no match")
    expect(readFileSync(target, "utf8")).toBe("original")
  })

  it("keeps serving the queue after a mutation fails", async () => {
    // A rejected mutation must not strand the ones chained behind it.
    const workspace = createWorkspace(createRoot())
    const target = workspace.resolve("greet.ts")
    await workspace.write(target, "original")

    const failing = workspace.mutate(target, () => {
      throw new Error("no match")
    })
    const following = workspace.mutate(target, (current) => ({ text: `${current}!`, result: current }))

    await expect(failing).rejects.toThrow("no match")
    await following

    expect(readFileSync(target, "utf8")).toBe("original!")
  })

  it("reports a missing file as ENOENT", async () => {
    const workspace = createWorkspace(createRoot())

    const attempt = workspace.mutate(workspace.resolve("absent.ts"), (current) => ({ text: current, result: current }))

    await expect(attempt).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("leaves no temp files behind", async () => {
    const root = createRoot()
    const workspace = createWorkspace(root)
    const target = workspace.resolve("greet.ts")
    await workspace.write(target, "a")
    await workspace.mutate(target, (current) => ({ text: `${current}b`, result: undefined }))

    const files = await workspace.listFiles(root, { recursive: false })

    expect(files).toEqual([target])
  })
})

describe("workspace listing", () => {
  it("lists one directory by default and walks it on request", async () => {
    const root = createRoot()
    const workspace = createWorkspace(root)
    mkdirSync(join(root, "sub"))
    writeFileSync(join(root, "top.ts"), "")
    writeFileSync(join(root, "sub", "nested.ts"), "")

    expect(await workspace.listFiles(root, { recursive: false })).toEqual([join(root, "top.ts")])
    expect((await workspace.listFiles(root, { recursive: true })).sort()).toEqual([
      join(root, "sub", "nested.ts"),
      join(root, "top.ts"),
    ])
  })
})

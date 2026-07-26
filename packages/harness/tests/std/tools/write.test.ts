import { describe, expect, it } from "bun:test"
import { createToolContext } from "../../support/tool-context"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WriteTool } from "@harness/std/tools/write"
import type { ToolContext, ToolMetadata } from "@harness/types"

function metadataOf(result: { metadata?: ToolMetadata }) {
  return (result.metadata ?? {}) as Record<string, unknown>
}

describe("WriteTool", () => {
  it("creates the file and its parent directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "nested", "deep", "report.html")

    const result = await WriteTool.execute({ filePath: target, content: "<!doctype html>" }, createToolContext())

    expect(readFileSync(target, "utf8")).toBe("<!doctype html>")
    expect(metadataOf(result).created).toBe(true)
    expect(metadataOf(result).totalBytes).toBe(15)
  })

  it("replaces the file wholesale, discarding what was there", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "report.html")
    const ctx = createToolContext()

    await WriteTool.execute({ filePath: target, content: "first" }, ctx)
    await WriteTool.execute({ filePath: target, content: "second" }, ctx)

    expect(readFileSync(target, "utf8")).toBe("second")
  })

  it("counts bytes rather than characters for multibyte content", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "report.html")

    const result = await WriteTool.execute({ filePath: target, content: "洞察" }, createToolContext())

    expect(metadataOf(result).bytesWritten).toBe(6)
  })

  it("keeps the output to one line instead of echoing the content back", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "report.html")
    const content = "x".repeat(5000)

    const result = await WriteTool.execute({ filePath: target, content }, createToolContext())

    expect(result.output).not.toContain(content)
    expect(result.output.split("\n")).toHaveLength(1)
  })

  it("fails loudly when the path is a directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "adir")
    mkdirSync(target)

    const attempt = WriteTool.execute({ filePath: target, content: "x" }, createToolContext())

    await expect(attempt).rejects.toMatchObject({ info: { code: "write_not_a_file" } })
  })
})

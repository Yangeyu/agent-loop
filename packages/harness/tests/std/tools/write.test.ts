import { describe, expect, it } from "bun:test"
import { createToolContext } from "../../support/tool-context"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createWriteTool } from "@harness/std/tools/write"

import { createWorkspace } from "@harness/workspace"

const WriteTool = createWriteTool({ workspace: createWorkspace() })

describe("WriteTool", () => {
  it("creates the file and its parent directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "nested", "deep", "report.html")

    const result = await WriteTool.execute({ filePath: target, content: "<!doctype html>" }, createToolContext())

    expect(readFileSync(target, "utf8")).toBe("<!doctype html>")
    // Reported in the sentence rather than a metadata block — the model already
    // sent the path and the content, so restating them as JSON buys nothing.
    expect(result.output).toBe(`Created ${target} (15 bytes).`)
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

    expect(result.output).toContain("(6 bytes)")
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

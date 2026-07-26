import { describe, expect, it } from "bun:test"
import { createToolContext } from "../../support/tool-context"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EditTool } from "@harness/std/tools/edit"
import type { ToolMetadata } from "@harness/types"

const SOURCE = [
  "export function greet(name: string) {",
  "  return `hello ${name}`",
  "}",
  "",
  "export function farewell(name: string) {",
  "  return `bye ${name}`",
  "}",
  "",
].join("\n")

function writeSource(content = SOURCE) {
  const target = join(mkdtempSync(join(tmpdir(), "edit-")), "greet.ts")
  writeFileSync(target, content)
  return target
}

function metadataOf(result: { metadata?: ToolMetadata }) {
  return (result.metadata ?? {}) as Record<string, unknown>
}

describe("EditTool", () => {
  it("replaces a uniquely matched snippet and leaves the rest untouched", async () => {
    const target = writeSource()

    const result = await EditTool.execute(
      { filePath: target, oldString: "return `hello ${name}`", newString: "return `hi ${name}`" },
      createToolContext(),
    )

    const updated = readFileSync(target, "utf8")
    expect(updated).toContain("return `hi ${name}`")
    expect(updated).toContain("return `bye ${name}`")
    expect(metadataOf(result).replacements).toBe(1)
  })

  it("keeps both changes when two edits race on one file", async () => {
    // The regression this guards: both calls used to read the original text and
    // the second write erased the first one's change. They share a context, and
    // so a workspace — which is what serializes them.
    const target = writeSource()
    const ctx = createToolContext()

    await Promise.all([
      EditTool.execute({ filePath: target, oldString: "return `hello ${name}`", newString: "return `hi ${name}`" }, ctx),
      EditTool.execute({ filePath: target, oldString: "return `bye ${name}`", newString: "return `goodbye ${name}`" }, ctx),
    ])

    const updated = readFileSync(target, "utf8")
    expect(updated).toContain("return `hi ${name}`")
    expect(updated).toContain("return `goodbye ${name}`")
  })

  it("returns the edited region with line numbers so the caller can confirm placement", async () => {
    const target = writeSource()

    const result = await EditTool.execute(
      { filePath: target, oldString: "return `bye ${name}`", newString: "return `farewell ${name}`" },
      createToolContext(),
    )

    expect(result.output).toContain("6 | ")
    expect(result.output).toContain("return `farewell ${name}`")
    expect(metadataOf(result).line).toBe(6)
  })

  it("refuses an ambiguous match instead of picking one", async () => {
    const target = writeSource()

    const attempt = EditTool.execute(
      { filePath: target, oldString: "  return `", newString: "  return `x" },
      createToolContext(),
    )

    await expect(attempt).rejects.toMatchObject({ info: { code: "edit_not_unique" } })
    // The file must be untouched when the edit is refused.
    expect(readFileSync(target, "utf8")).toBe(SOURCE)
  })

  it("replaces every occurrence when explicitly asked", async () => {
    const target = writeSource()

    const result = await EditTool.execute(
      { filePath: target, oldString: "${name}", newString: "${who}", replaceAll: true },
      createToolContext(),
    )

    expect(readFileSync(target, "utf8")).not.toContain("${name}")
    expect(metadataOf(result).replacements).toBe(2)
  })

  it("diagnoses an indentation mismatch rather than relaxing the match", async () => {
    const target = writeSource()

    // Same text, wrong indentation on an inner line — the most common way a
    // verbatim copy fails. (A missing indent on the *first* line would still
    // match, since the search is over substrings.)
    const attempt = EditTool.execute(
      {
        filePath: target,
        oldString: "export function greet(name: string) {\nreturn `hello ${name}`\n}",
        newString: "export function greet() {\nreturn `hi`\n}",
      },
      createToolContext(),
    )

    await expect(attempt).rejects.toMatchObject({
      info: { code: "edit_no_match", message: expect.stringContaining("line 1") },
    })
    expect(readFileSync(target, "utf8")).toBe(SOURCE)
  })

  it("says the text is simply absent when nothing resembles it", async () => {
    const target = writeSource()

    const attempt = EditTool.execute(
      { filePath: target, oldString: "export function missing() {}", newString: "x" },
      createToolContext(),
    )

    await expect(attempt).rejects.toMatchObject({
      info: { code: "edit_no_match", message: expect.stringContaining("does not appear") },
    })
  })

  it("rejects an edit that would change nothing", async () => {
    const target = writeSource()

    const attempt = EditTool.execute(
      { filePath: target, oldString: "return `hello ${name}`", newString: "return `hello ${name}`" },
      createToolContext(),
    )

    await expect(attempt).rejects.toMatchObject({ info: { code: "edit_no_op" } })
  })

  it("reports a missing file as such", async () => {
    const attempt = EditTool.execute(
      { filePath: join(tmpdir(), "definitely-absent-file.ts"), oldString: "a", newString: "b" },
      createToolContext(),
    )

    await expect(attempt).rejects.toMatchObject({ info: { code: "edit_not_found" } })
  })

  it("refuses to treat a directory as a file", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "edit-")), "adir")
    mkdirSync(dir)

    const attempt = EditTool.execute({ filePath: dir, oldString: "a", newString: "b" }, createToolContext())

    await expect(attempt).rejects.toMatchObject({ info: { code: "tool_execution_failed" } })
  })

  it("deletes the matched text when newString is empty", async () => {
    const target = writeSource()

    await EditTool.execute(
      { filePath: target, oldString: "\nexport function farewell(name: string) {\n  return `bye ${name}`\n}\n", newString: "" },
      createToolContext(),
    )

    const updated = readFileSync(target, "utf8")
    expect(updated).not.toContain("farewell")
    expect(updated).toContain("greet")
  })
})

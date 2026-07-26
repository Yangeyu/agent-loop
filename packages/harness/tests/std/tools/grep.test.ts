import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createToolContext } from "../../support/tool-context"
import { GrepTool } from "@harness/std/tools/grep"
import { createWorkspace } from "@harness/workspace"

function createTree() {
  const root = mkdtempSync(join(tmpdir(), "grep-"))
  mkdirSync(join(root, "packages", "harness", "src"), { recursive: true })
  writeFileSync(join(root, "packages", "harness", "src", "deep.ts"), "export const marker = 1\n")
  writeFileSync(join(root, "packages", "shallow.ts"), "const other = 2\n")
  return root
}

function contextFor(root: string) {
  return createToolContext({ workspace: createWorkspace(root) })
}

describe("GrepTool", () => {
  it("searches nested directories, not just the top level of each root", async () => {
    // The regression this guards: the search once ran non-recursively, so every
    // query returned "no matches" — source lives several levels under packages/,
    // never directly in it.
    const root = createTree()

    const result = await GrepTool.execute({ pattern: "marker" }, contextFor(root))

    expect(result.output).toContain("deep.ts")
    expect(result.metadata?.matchCount).toBe(1)
  })

  it("reports no matches without failing when the pattern is absent", async () => {
    const result = await GrepTool.execute({ pattern: "definitely_absent_xyz" }, contextFor(createTree()))

    expect(result.metadata?.matchCount).toBe(0)
    expect(result.output).toContain("No matches")
  })

  it("rejects an invalid regular expression with a stable code", async () => {
    const attempt = GrepTool.execute({ pattern: "([unclosed" }, contextFor(createTree()))

    await expect(attempt).rejects.toMatchObject({ info: { code: "grep_invalid_pattern" } })
  })
})

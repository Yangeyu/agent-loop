import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkillFile, loadSkillsFromDir } from "@harness/std/skills/load"

function makeSkillDir(root: string, name: string, skillMd: string) {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), skillMd)
  return dir
}

describe("loadSkillFile", () => {
  it("parses frontmatter metadata and body content", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"))
    const dir = makeSkillDir(
      root,
      "deploy",
      ['---', 'name: deploy', 'description: "How to deploy: step by step."', '---', '', '## Steps', 'Run the pipeline.'].join("\n"),
    )

    const skill = loadSkillFile(join(dir, "SKILL.md"))

    expect(skill.name).toBe("deploy")
    expect(skill.description).toBe("How to deploy: step by step.")
    expect(skill.location).toBe(join(dir, "SKILL.md"))
    expect(skill.content).toBe("## Steps\nRun the pipeline.")
  })

  it("falls back to the directory name when frontmatter has no name", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"))
    const dir = makeSkillDir(root, "review", ["---", "description: Review workflow.", "---", "body"].join("\n"))

    expect(loadSkillFile(join(dir, "SKILL.md")).name).toBe("review")
  })

  it("throws on a missing description", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"))
    const dir = makeSkillDir(root, "broken", ["---", "name: broken", "---", "body"].join("\n"))

    expect(() => loadSkillFile(join(dir, "SKILL.md"))).toThrow(/missing a frontmatter "description"/)
  })

  it("throws when the frontmatter block is missing or unterminated", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"))
    const noBlock = makeSkillDir(root, "no-block", "just markdown")
    const open = makeSkillDir(root, "open", ["---", "description: x", "body"].join("\n"))

    expect(() => loadSkillFile(join(noBlock, "SKILL.md"))).toThrow(/must start with/)
    expect(() => loadSkillFile(join(open, "SKILL.md"))).toThrow(/unterminated/)
  })
})

describe("loadSkillsFromDir", () => {
  it("discovers each subdirectory with a SKILL.md and skips the rest", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-"))
    makeSkillDir(root, "beta", ["---", "description: Second skill.", "---", "b"].join("\n"))
    makeSkillDir(root, "alpha", ["---", "description: First skill.", "---", "a"].join("\n"))
    mkdirSync(join(root, "assets"))
    writeFileSync(join(root, "README.md"), "not a skill")

    const skills = loadSkillsFromDir(root)

    expect(skills.map((skill) => skill.name)).toEqual(["alpha", "beta"])
    expect(skills.map((skill) => skill.dir)).toEqual([join(root, "alpha"), join(root, "beta")])
  })

  it("throws on a missing directory, but treats it as empty when optional", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "skills-")), "absent")

    expect(() => loadSkillsFromDir(missing)).toThrow()
    expect(loadSkillsFromDir(missing, { optional: true })).toEqual([])
  })
})

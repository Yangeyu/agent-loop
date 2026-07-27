import { describe, expect, it } from "bun:test"
import { createToolContext } from "../../support/tool-context"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSkillRegistry } from "@harness/skill/registry"
import { createWorkspace } from "@harness/workspace"
import type { SkillInfo } from "@harness/skill/types"
import { loadSkillFile } from "@harness/std/skills/load"
import { createSkillTool } from "@harness/std/tools/skill"

// The tool holds its own catalogue, so a test builds one around the skills it
// is asserting on.
function skillTool(skills: SkillInfo[]) {
  const registry = createSkillRegistry()
  for (const skill of skills) registry.register(skill)
  return createSkillTool({ skills: registry, workspace: createWorkspace() })
}

function makeSkill(assets: Record<string, string>) {
  const dir = join(mkdtempSync(join(tmpdir(), "skill-tool-")), "render")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), ["---", "description: Render a report.", "---", "body"].join("\n"))
  for (const [name, content] of Object.entries(assets)) writeFileSync(join(dir, name), content)
  return { dir, skill: loadSkillFile(join(dir, "SKILL.md")) }
}

describe("SkillTool", () => {
  it("lists sibling assets by absolute path and excludes SKILL.md itself", async () => {
    const { dir, skill } = makeSkill({ "template.html": "<html>", "design.md": "# design" })

    const result = await skillTool([skill]).execute({ name: "render" }, createToolContext())

    expect(result.output).toContain(`Directory: ${dir}`)
    expect(result.output).toContain(`- ${join(dir, "design.md")}`)
    expect(result.output).toContain(`- ${join(dir, "template.html")}`)
    expect(result.output).not.toContain(`- ${join(dir, "SKILL.md")}`)
  })

  it("omits the asset section for a skill with no sibling files", async () => {
    const { skill } = makeSkill({})

    const result = await skillTool([skill]).execute({ name: "render" }, createToolContext())

    expect(result.output).not.toContain("Assets")
    expect(result.output).toContain("Location:")
  })

  it("omits the asset section for a skill that has no directory", async () => {
    const inline: SkillInfo = {
      name: "inline",
      description: "Defined in code.",
      location: "<inline>",
      content: "body",
    }

    const result = await skillTool([inline]).execute({ name: "inline" }, createToolContext())

    expect(result.output).not.toContain("Assets")
  })
})

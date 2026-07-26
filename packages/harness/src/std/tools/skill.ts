import { readdirSync } from "node:fs"
import { join } from "node:path"
import type { SkillInfo } from "@harness/skill/types"
import { defineTool, ToolExecutionError } from "@harness/tool/tool"
import { z } from "zod"

const SkillParameters = z.object({
  name: z.string().describe("The name of the skill to load"),
})

export const SkillTool = defineTool({
  id: "skill",
  description: "Load a specialized skill that provides domain-specific instructions and workflows.",
  parameters: SkillParameters,
  async execute(args, ctx) {
    const skill = ctx.skill_registry.get(args.name)
    if (!skill) {
      const available = ctx.skill_registry.list().map((item) => item.name)
      throw new ToolExecutionError({
        message: `Unknown skill: ${args.name}. Available skills: ${available.join(", ") || "none"}`,
        retryable: false,
        code: "skill_not_found",
      })
    }

    return {
      title: `Loaded skill: ${skill.name}`,
      output: renderSkillContent(skill),
      metadata: {
        name: skill.name,
        location: skill.location,
      },
    }
  },
})

function renderSkillContent(skill: SkillInfo) {
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Location: ${skill.location}`,
    ...renderAssets(skill),
    "</skill_content>",
  ].join("\n")
}

// Skill bodies refer to their assets relatively ("read ./template.html"), but
// the read tool resolves against the process cwd. Listing the absolute paths
// here removes the guesswork rather than asking the model to rebuild them.
function renderAssets(skill: SkillInfo) {
  const dir = skill.dir
  if (!dir) return []

  const assets = listAssets(dir, skill.location)
  if (!assets.length) return []

  return [
    `Directory: ${dir}`,
    "Assets (pass these absolute paths to the read tool):",
    ...assets.map((asset) => `- ${asset}`),
  ]
}

function listAssets(dir: string, skillFile: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && join(dir, entry.name) !== skillFile)
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    // A skill whose directory moved after discovery still has usable content;
    // losing the asset list is not worth failing the load over.
    return []
  }
}

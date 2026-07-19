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
    "</skill_content>",
  ].join("\n")
}

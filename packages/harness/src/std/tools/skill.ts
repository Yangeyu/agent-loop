import type { PromptContributor } from "@harness/std/prompt"
import type { SkillRegistry } from "@harness/skill/registry"
import type { SkillInfo } from "@harness/skill/types"
import { defineTool, ToolExecutionError } from "@harness/tool/tool"
import type { Workspace } from "@harness/workspace"
import { z } from "zod"

const SkillParameters = z.object({
  name: z.string().describe("The name of the skill to load"),
})

/** What the skill tool and its announcement both read. */
export type SkillDeps = { skills: SkillRegistry; workspace: Workspace }

/**
 * Prompt axis: announces what this tool can load. It ships with the tool because
 * the announced set and the set `execute` accepts are the same registry read —
 * an agent that enables `skill` registers this alongside it.
 */
export function createAvailableSkills(deps: { skills: SkillRegistry }): PromptContributor {
  return () => {
    const skills = deps.skills.list()
    if (skills.length === 0) return undefined

    return {
      slot: "capability",
      text: [
        "Use the skill tool when the task matches one of these specialized workflows.",
        "<available_skills>",
        ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
        "</available_skills>",
      ].join("\n"),
    }
  }
}

/** Builds the skill tool bound to a skill catalogue and a workspace. */
export function createSkillTool(deps: SkillDeps) {
  return defineTool({
    id: "skill",
    description: "Load a specialized skill that provides domain-specific instructions and workflows.",
    parameters: SkillParameters,
    describe(args) {
      return { verb: "skill", target: args.name }
    },
    async execute(args) {
      const skill = deps.skills.get(args.name)
      if (!skill) {
        const available = deps.skills.list().map((item) => item.name)
        throw new ToolExecutionError({
          message: `Unknown skill: ${args.name}. Available skills: ${available.join(", ") || "none"}`,
          retryable: false,
          code: "skill_not_found",
        })
      }

      return {
        output: await renderSkillContent(deps.workspace, skill),
        metadata: {
          name: skill.name,
          location: skill.location,
        },
      }
    },
  })
}

async function renderSkillContent(workspace: Workspace, skill: SkillInfo) {
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Location: ${skill.location}`,
    ...(await renderAssets(workspace, skill)),
    "</skill_content>",
  ].join("\n")
}

// Skill bodies refer to their assets relatively ("read ./template.html"), but
// the read tool resolves against the workspace root, not the skill's directory.
// Listing the absolute paths here removes the guesswork rather than asking the
// model to rebuild them.
async function renderAssets(workspace: Workspace, skill: SkillInfo) {
  const dir = skill.dir
  if (!dir) return []

  const assets = await listAssets(workspace, dir, skill.location)
  if (!assets.length) return []

  return [
    `Directory: ${dir}`,
    "Assets (pass these absolute paths to the read tool):",
    ...assets.map((asset) => `- ${asset}`),
  ]
}

async function listAssets(workspace: Workspace, dir: string, skillFile: string) {
  try {
    const files = await workspace.listFiles(dir, { recursive: false })
    return files.filter((file) => file !== skillFile).sort()
  } catch {
    // A skill whose directory moved after discovery still has usable content;
    // losing the asset list is not worth failing the load over.
    return []
  }
}

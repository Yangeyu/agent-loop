import { loadSkillsFromDir, type SkillInfo } from "@harness"

// Each subdirectory here is one skill (SKILL.md carries the frontmatter
// metadata + workflow body); discovery replaces hand-copied metadata.
export const boardSkills: SkillInfo[] = loadSkillsFromDir(import.meta.dir)

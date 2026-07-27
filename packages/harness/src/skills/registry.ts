import type { SkillInfo } from "@harness/skills/types"

export type SkillRegistry = {
  skills: Map<string, SkillInfo>
  register(skill: SkillInfo): void
  get(name: string): SkillInfo | undefined
  list(): SkillInfo[]
}

export function createSkillRegistry(): SkillRegistry {
  return {
    skills: new Map<string, SkillInfo>(),

    register(skill) {
      const existing = this.skills.get(skill.name)
      if (existing === skill) return
      if (existing) {
        throw new Error(`Duplicate skill registration: ${skill.name}`)
      }
      this.skills.set(skill.name, skill)
    },

    get(name) {
      return this.skills.get(name)
    },

    list() {
      return [...this.skills.values()].sort((left, right) => left.name.localeCompare(right.name))
    },
  }
}

export type SkillInfo = {
  name: string
  description: string
  location: string
  content: string
  /**
   * Directory holding the skill's sibling assets, when it has one. Filesystem
   * discovery fills this in; inline or database-backed skills leave it unset.
   */
  dir?: string
}

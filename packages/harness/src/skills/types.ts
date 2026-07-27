export type SkillInfo = {
  name: string
  description: string
  location: string
  content: string
  // Directory holding the skill's sibling assets, when it has one. Filesystem
  // discovery fills this in; skills defined inline or loaded from a database
  // have no directory and leave it unset.
  dir?: string
}

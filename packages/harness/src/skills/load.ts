// Filesystem discovery for skills, following the Agent Skills convention:
// one directory per skill containing a SKILL.md whose YAML frontmatter carries
// the index metadata (name, description) and whose body is the skill content.
// Discovery is optional — the contract stays the pure SkillInfo data shape,
// so skills can equally come from a database or inline.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import type { SkillInfo } from "@harness/skills/types"

const SKILL_FILE = "SKILL.md"

/**
 * Loads one skill from a markdown file with YAML frontmatter.
 *
 * The frontmatter must provide `description`; `name` falls back to the
 * enclosing directory (for SKILL.md) or the file basename. Malformed or
 * missing frontmatter throws — a skill that cannot be indexed is a
 * composition error, not a runtime condition.
 *
 * @param filePath - path to the skill markdown file
 * @returns the parsed SkillInfo (location is the resolved file path, dir its parent)
 */
export function loadSkillFile(filePath: string): SkillInfo {
  const target = resolve(filePath)
  const raw = readFileSync(target, "utf8")
  const { frontmatter, body } = splitFrontmatter(raw, target)

  const description = frontmatter.description
  if (!description) {
    throw new Error(`skill file ${target} is missing a frontmatter "description"`)
  }
  const fallbackName = basename(target) === SKILL_FILE ? basename(dirname(target)) : basename(target, ".md")

  return {
    name: frontmatter.name ?? fallbackName,
    description,
    location: target,
    content: body.trim(),
    dir: dirname(target),
  }
}

/**
 * Discovers skills under a directory: every immediate subdirectory containing
 * a SKILL.md is loaded as one skill (subdirectories without one are skipped,
 * so skills can keep sibling asset folders). Returned sorted by name.
 *
 * A missing directory throws, since a composition root that names a skills
 * directory should learn it is wrong. Pass `optional` for a conventional
 * location (e.g. a workspace's `./skills`) where absence means "no skills"
 * rather than a misconfiguration.
 *
 * @param dir - the skills root directory
 * @param options.optional - treat a missing directory as empty instead of throwing
 * @returns the discovered skills
 */
export function loadSkillsFromDir(dir: string, options?: { optional?: boolean }): SkillInfo[] {
  const root = resolve(dir)
  if (options?.optional && !existsSync(root)) return []

  const skills: SkillInfo[] = []

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillFile = join(root, entry.name, SKILL_FILE)
    if (!existsSync(skillFile)) continue
    skills.push(loadSkillFile(skillFile))
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

// Minimal frontmatter reader: a leading `---` block of `key: value` lines.
// Deliberately not a YAML parser — nested structures in skill metadata would
// be a smell, and failing fast beats silently misreading them.
function splitFrontmatter(raw: string, target: string) {
  const lines = raw.split("\n")
  if (lines[0]?.trim() !== "---") {
    throw new Error(`skill file ${target} must start with a "---" frontmatter block`)
  }

  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (close === -1) {
    throw new Error(`skill file ${target} has an unterminated frontmatter block`)
  }

  const frontmatter: Record<string, string> = {}
  for (const line of lines.slice(1, close)) {
    if (!line.trim() || line.trim().startsWith("#")) continue
    const separator = line.indexOf(":")
    if (separator === -1) {
      throw new Error(`skill file ${target} has a malformed frontmatter line: ${line.trim()}`)
    }
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "")
    frontmatter[key] = value
  }

  return { frontmatter, body: lines.slice(close + 1).join("\n") }
}

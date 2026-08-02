/**
 * The file backend for MemoryStore: one markdown file per live record under
 * `dir`, archived records under `dir/archive`. Files are the truth — the
 * in-memory map is a lazily built read cache this single-process store keeps
 * consistent through its own writes. Frontmatter values are JSON-encoded,
 * which keeps the format human-readable while making the round-trip exact;
 * these files are machine-written, so the writer and the parser are the same
 * module. A file that fails to parse throws with its path — a corrupt memory
 * is never reported as absent.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { z } from "zod"
import {
  MEMORY_NAME_PATTERN,
  MEMORY_TYPES,
  type ArchiveReason,
  type MemoryIndexEntry,
  type MemoryRecord,
  type MemoryStore,
  type RecallHint,
} from "@harness/memory/types"

// Typed against the contract so schema and type cannot drift apart. This is
// the boundary where disk content becomes a trusted record.
const RecordSchema: z.ZodType<MemoryRecord> = z.object({
  name: z.string().regex(MEMORY_NAME_PATTERN),
  description: z.string().min(1),
  type: z.enum(MEMORY_TYPES),
  scope: z.enum(["workspace", "global"]),
  origin: z.enum(["explicit", "extracted"]),
  sources: z.array(z.string()),
  disputed: z.array(z.string()).optional(),
  links: z.array(z.string()).optional(),
  body: z.string(),
})

const ARCHIVE_DIR = "archive"

/** The file-backed memory store. `dir` is created lazily on the first write. */
export class FileMemoryStore implements MemoryStore {
  private dir: string
  private cache: Map<string, MemoryRecord> | undefined

  constructor(dir: string = "./data/memory") {
    this.dir = resolve(dir)
  }

  recall(hint?: RecallHint): MemoryIndexEntry[] {
    let records = [...this.load().values()]
    if (hint?.types?.length) records = records.filter((record) => hint.types!.includes(record.type))
    if (hint?.scope) records = records.filter((record) => record.scope === hint.scope)
    // `query` is deliberately ignored: this backend may over-return, never fabricate.
    return records
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, description, type, scope }) => ({ name, description, type, scope }))
  }

  read(name: string): MemoryRecord | null {
    return this.load().get(name) ?? null
  }

  upsert(record: MemoryRecord, opts?: { supersedes?: string[] }): void {
    const parsed = RecordSchema.parse(record)
    const live = this.load()

    const superseded: MemoryRecord[] = []
    for (const target of opts?.supersedes ?? []) {
      if (target === parsed.name) throw new Error(`memory record "${target}" cannot supersede itself`)
      const targetRecord = live.get(target)
      if (!targetRecord) throw new Error(`cannot supersede "${target}": no live memory record has that name`)
      superseded.push(targetRecord)
    }

    // New fact lands before the old ones leave: a crash in between shows both
    // in the index, which beats a window where the fact exists nowhere.
    this.writeRecord(parsed)
    live.set(parsed.name, parsed)
    for (const targetRecord of superseded) {
      this.archive(targetRecord, "superseded", parsed.name)
    }
  }

  remove(name: string, reason: ArchiveReason): void {
    const record = this.load().get(name)
    if (!record) throw new Error(`cannot archive "${name}": no live memory record has that name`)
    this.archive(record, reason)
  }

  private load(): Map<string, MemoryRecord> {
    if (this.cache) return this.cache

    const records = new Map<string, MemoryRecord>()
    if (existsSync(this.dir)) {
      for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue
        const record = this.parseRecordFile(join(this.dir, entry.name))
        records.set(record.name, record)
      }
    }
    this.cache = records
    return records
  }

  private writeRecord(record: MemoryRecord): void {
    mkdirSync(this.dir, { recursive: true })
    const file = this.recordPath(record.name)
    const tmp = `${file}.tmp`
    writeFileSync(tmp, serializeRecord(record))
    renameSync(tmp, file)
  }

  // Archival is a move plus a reason stamp. Re-archiving a reused name
  // overwrites the older archive copy — the latest departure wins.
  private archive(record: MemoryRecord, reason: ArchiveReason, supersededBy?: string): void {
    const archiveDir = join(this.dir, ARCHIVE_DIR)
    mkdirSync(archiveDir, { recursive: true })
    writeFileSync(
      join(archiveDir, `${record.name}.md`),
      serializeRecord(record, { archived_reason: reason, ...(supersededBy ? { superseded_by: supersededBy } : {}) }),
    )
    unlinkSync(this.recordPath(record.name))
    this.load().delete(record.name)
  }

  private parseRecordFile(file: string): MemoryRecord {
    try {
      const { fields, body } = splitFrontmatter(readFileSync(file, "utf8"))
      return RecordSchema.parse({ ...fields, body })
    } catch (error) {
      throw new Error(`Corrupt memory record: ${file}`, { cause: error })
    }
  }

  private recordPath(name: string): string {
    // The schema's name pattern is what keeps this a filename, not a path.
    return join(this.dir, `${name}.md`)
  }
}

function serializeRecord(record: MemoryRecord, extra?: Record<string, unknown>): string {
  const { body, ...fields } = record
  const lines = Object.entries({ ...fields, ...extra })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  return ["---", ...lines, "---", body].join("\n")
}

function splitFrontmatter(raw: string): { fields: Record<string, unknown>; body: string } {
  const lines = raw.split("\n")
  if (lines[0]?.trim() !== "---") throw new Error(`missing "---" frontmatter opener`)
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (close === -1) throw new Error("unterminated frontmatter block")

  const fields: Record<string, unknown> = {}
  for (const line of lines.slice(1, close)) {
    if (!line.trim()) continue
    const separator = line.indexOf(": ")
    if (separator === -1) throw new Error(`malformed frontmatter line: ${line}`)
    fields[line.slice(0, separator)] = JSON.parse(line.slice(separator + 2))
  }
  return { fields, body: lines.slice(close + 1).join("\n") }
}

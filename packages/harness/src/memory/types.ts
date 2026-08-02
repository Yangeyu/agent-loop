/**
 * The memory capability's contract vocabulary: what a remembered fact is, how
 * it is indexed for recall, and the store operations everything else composes.
 * The harness owns memory the way it owns skills — the loop never sees it.
 * Recall enters as a prompt contributor, writes enter as a tool and (later) a
 * settle-time extraction middleware; all of them share one MemoryStore
 * instance through their factory closures. Backends implement the interface;
 * the composition root picks one.
 */

/** Content dimension: what kind of fact a record holds. */
export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

/** Reach dimension: the fact travels with this workspace or with the user. */
export type MemoryScope = "workspace" | "global"

/**
 * How the record entered the store. This is the trust order consolidation
 * enforces deterministically: `explicit` (written through the memory tool on
 * a direct decision) outranks `extracted` (proposed by settle-time
 * extraction). An extracted candidate can never overwrite an explicit record.
 */
export type MemoryOrigin = "explicit" | "extracted"

/**
 * Why a record left the live index. `falsified` is the interesting one: its
 * rate over time is the extractor's measured error rate, free calibration
 * data for tightening the write path.
 */
export type ArchiveReason = "superseded" | "falsified" | "expired"

/**
 * Record names are identities and derive storage paths, so the pattern is
 * load-bearing: kebab-case only, no separators that could escape the store
 * directory. Every boundary that accepts a name validates against this.
 */
export const MEMORY_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** One remembered fact. The record is the unit of recall, update, and archival. */
export type MemoryRecord = {
  /** Identity. Kebab-case slug matching MEMORY_NAME_PATTERN. */
  name: string
  /** One-line hook shown in the recall index; relevance is judged from it. */
  description: string
  type: MemoryType
  scope: MemoryScope
  origin: MemoryOrigin
  /**
   * Session IDs this fact was written or revised from, oldest first. The
   * chain accumulates across updates — it is provenance for debugging and
   * bulk cleanup, and its length is a cheap confirmation signal.
   */
  sources: string[]
  /**
   * Session IDs whose extraction contradicted this record but lacked the
   * authority to change it. A disputed record survives untouched; the marks
   * queue it for an explicit decision.
   */
  disputed?: string[]
  /** Names of related records. Dangling links are allowed — they mark facts worth writing, not errors. */
  links?: string[]
  /** The fact itself, markdown. */
  body: string
}

/** One line of the recall index — the always-injected slice of a record. */
export type MemoryIndexEntry = Pick<MemoryRecord, "name" | "description" | "type" | "scope">

/**
 * Narrows what recall returns. Every field is advisory: an implementation may
 * ignore a field it cannot serve (the file backend ignores `query`) and
 * over-return, but must never fabricate entries. This is the seam that lets
 * relevance-ranked retrieval arrive as a backend upgrade, not a contract
 * change.
 */
export type RecallHint = {
  types?: MemoryType[]
  scope?: MemoryScope
  /** Free-text relevance hint, e.g. the current task. */
  query?: string
}

/**
 * The memory store contract. Mirrors SessionPersistence in spirit: the
 * harness ships a file backend behind it, external backends arrive as
 * injected instances. Implementations own their consistency — a multi-file
 * operation like a supersede is atomic inside the store, and a corrupt
 * record fails loudly on read, never reported as absent.
 */
export interface MemoryStore {
  /** Returns the live index, narrowed by the hint where the backend can. */
  recall(hint?: RecallHint): MemoryIndexEntry[]
  /** Returns the full record, or null when no live record has that name. */
  read(name: string): MemoryRecord | null
  /**
   * Creates or replaces the record under its name. When `supersedes` names
   * live records, they are archived (reason `superseded`, stamped with the
   * new name) in the same atomic step — the index never shows both.
   */
  upsert(record: MemoryRecord, opts?: { supersedes?: string[] }): void
  /**
   * Archives the record under the given reason. Removal never destroys:
   * archived records leave the index but stay readable for provenance
   * cleanup and calibration. Physical deletion is a human act outside this
   * contract.
   */
  remove(name: string, reason: ArchiveReason): void
}

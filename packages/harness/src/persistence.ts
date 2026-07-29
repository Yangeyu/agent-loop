/**
 * The harness's session storage backends, behind agent-core's
 * SessionPersistence contract. The engine ships only the contract and the
 * in-memory default; wanting sessions on disk is this layer's choice, so the
 * file backend and the config-keyed selection live here. An external backend
 * (database, remote) skips the config path entirely and arrives as an
 * injected instance.
 */
import fs from "node:fs"
import path from "node:path"
import { MemorySessionPersistence, type SessionInfo, type SessionPersistence } from "@agent-core"

// How long persisted snapshots may sit dirty before flushing to disk. Streaming
// deltas persist on every chunk; coalescing bounds the write rate while keeping
// the loss window on a hard crash to this interval.
const FLUSH_DELAY_MS = 50

/**
 * File persistence: one JSON file per session under `dir`. The in-memory cache
 * is the live truth; disk writes are coalesced (one timer, all dirty sessions)
 * and atomic (tmp + rename). A corrupt session file fails loudly on read — it
 * is never reported as "not found".
 */
export class FileSessionPersistence implements SessionPersistence {
  private cache = new Map<string, SessionInfo>()
  private dirty = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private dir: string = "./data/sessions") {
    fs.mkdirSync(this.dir, { recursive: true })
    // Normal process exit must not lose the trailing flush window.
    process.on("exit", () => this.flush())
  }

  read(sessionID: string): SessionInfo | null {
    const cached = this.cache.get(sessionID)
    if (cached) return cached

    const file = this.filePath(sessionID)
    if (!fs.existsSync(file)) return null

    const session = this.parseSessionFile(file)
    this.cache.set(sessionID, session)
    return session
  }

  persist(session: SessionInfo) {
    this.cache.set(session.id, session)
    this.dirty.add(session.id)
    this.scheduleFlush()
  }

  list() {
    const ids = fs
      .readdirSync(this.dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
    const known = new Set([...ids, ...this.cache.keys()])

    const sessions: SessionInfo[] = []
    for (const id of known) {
      const session = this.read(id)
      if (session) sessions.push(session)
    }
    return sessions
  }

  /** Writes all dirty sessions to disk now (atomic per file). */
  flush() {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }

    for (const id of this.dirty) {
      const session = this.cache.get(id)
      if (!session) continue
      const file = this.filePath(id)
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(session, null, 2))
      fs.renameSync(tmp, file)
    }
    this.dirty.clear()
  }

  private scheduleFlush() {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, FLUSH_DELAY_MS)
    // A pending flush must not keep a finished process alive.
    this.flushTimer.unref?.()
  }

  private parseSessionFile(file: string): SessionInfo {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as SessionInfo
    } catch (error) {
      throw new Error(`Corrupt session file: ${file}`, { cause: error })
    }
  }

  private filePath(sessionID: string) {
    return path.join(this.dir, `${sessionID}.json`)
  }
}

/**
 * Constructs the config-selected built-in backend. Unknown types are a config
 * bug and fail loudly — there is no silent fallback; external backends are
 * injected as instances, never added here as new config strings.
 *
 * @param config - selects the backend (`memory` | `file`) and the file directory
 * @returns the persistence instance
 */
export function createSessionPersistence(config: { session_store: "memory" | "file"; session_store_dir: string }): SessionPersistence {
  switch (config.session_store) {
    case "file":
      return new FileSessionPersistence(config.session_store_dir)
    case "memory":
      return new MemorySessionPersistence()
    default:
      throw new Error(`Unknown session store type: ${String(config.session_store)}`)
  }
}

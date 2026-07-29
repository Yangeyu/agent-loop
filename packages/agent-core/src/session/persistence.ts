/**
 * Session persistence: where session snapshots live. This is the entire
 * contract a storage backend implements — the domain logic (mutations,
 * projections, events) lives in the Sessions aggregate, which treats a backend
 * as a dumb snapshot store. Snapshots are immutable: the aggregate always
 * persists a new object, never mutates a stored one, so backends may cache by
 * reference.
 *
 * The engine ships only the contract and the in-memory default; real backends
 * (file, database, remote) are the embedder's and arrive as injected
 * instances. A slow backend keeps a warm cache as the live truth and
 * write-behinds to its medium — persist() is called on every streamed delta.
 */
import type { SessionInfo } from "@agent-core/model"

/** The storage contract: fetch, store, and enumerate session snapshots. */
export interface SessionPersistence {
  read(sessionID: string): SessionInfo | null
  persist(session: SessionInfo): void
  list(): SessionInfo[]
}

/** In-process Map persistence: lost on exit. The default for an uninjected engine. */
export class MemorySessionPersistence implements SessionPersistence {
  private sessions = new Map<string, SessionInfo>()

  read(sessionID: string) {
    return this.sessions.get(sessionID) ?? null
  }

  persist(session: SessionInfo) {
    this.sessions.set(session.id, session)
  }

  list() {
    return [...this.sessions.values()]
  }
}

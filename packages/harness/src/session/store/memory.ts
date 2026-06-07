/** In-memory session store: a Map, lost on process exit. Default for tests/dev. */
import type { SessionInfo } from "@harness/types"
import { BaseSessionStore } from "./base"

/** Session store backed by an in-process Map. */
export class MemorySessionStore extends BaseSessionStore {
  private sessions = new Map<string, SessionInfo>()

  protected read(sessionID: string) {
    return this.sessions.get(sessionID) ?? null
  }

  protected persist(session: SessionInfo) {
    this.sessions.set(session.id, session)
  }

  list() {
    return [...this.sessions.values()]
  }
}

import type { SessionInfo } from "@harness/types"
import { BaseSessionStore } from "./base"

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

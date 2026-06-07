import type { SessionInfo } from "@harness/types"
import { BaseSessionStore } from "./base"
import fs from "node:fs"
import path from "node:path"

export class FileSessionStore extends BaseSessionStore {
  private cache = new Map<string, SessionInfo>()

  constructor(private dir: string = "./data/sessions") {
    super()
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true })
    }
  }

  private filePath(sessionID: string) {
    return path.join(this.dir, `${sessionID}.json`)
  }

  protected read(sessionID: string): SessionInfo | null {
    const cached = this.cache.get(sessionID)
    if (cached) return cached
    const file = this.filePath(sessionID)
    if (!fs.existsSync(file)) return null
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8")) as SessionInfo
      this.cache.set(sessionID, data)
      return data
    } catch {
      return null
    }
  }

  protected persist(session: SessionInfo) {
    // SessionInfo is exactly the persisted shape, so the whole object round-trips.
    fs.writeFileSync(this.filePath(session.id), JSON.stringify(session, null, 2))
    this.cache.set(session.id, session)
  }

  list() {
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"))
    const sessions: SessionInfo[] = []
    for (const file of files) {
      try {
        sessions.push(this.get(file.replace(".json", "")))
      } catch {}
    }
    return sessions
  }
}

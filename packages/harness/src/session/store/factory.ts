import { FileSessionStore } from "./file"
import { MemorySessionStore } from "./memory"
import type { ISessionStore } from "./types"

export type SessionStoreType = "memory" | "file"

export type SessionStoreConfig = {
  session_store: SessionStoreType
  session_store_dir: string
}

export function createSessionStore(config: SessionStoreConfig): ISessionStore {
  switch (config.session_store) {
    case "file":
      return new FileSessionStore(config.session_store_dir)
    case "memory":
    default:
      return new MemorySessionStore()
  }
}

/** Selects and constructs a session store implementation from config. */
import { FileSessionStore } from "./file"
import { MemorySessionStore } from "./memory"
import type { ISessionStore } from "./types"

/** Which session store backend to use. */
export type SessionStoreType = "memory" | "file"

/** Config selecting the store backend and (for `file`) its directory. */
export type SessionStoreConfig = {
  session_store: SessionStoreType
  session_store_dir: string
}

/**
 * Constructs the configured session store.
 *
 * @param config - selects the backend (`memory` | `file`) and the file directory
 * @returns the store instance; falls back to an in-memory store
 */
export function createSessionStore(config: SessionStoreConfig): ISessionStore {
  switch (config.session_store) {
    case "file":
      return new FileSessionStore(config.session_store_dir)
    case "memory":
    default:
      return new MemorySessionStore()
  }
}

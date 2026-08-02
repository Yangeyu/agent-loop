/**
 * The engine environment: the dependency surface a loop runs on, and the named
 * default an embedder gets when it injects nothing.
 */
import { DEFAULT_CORE_CONFIG, type CoreConfig } from "@agent-core/config"
import { createRuntimeEvents, type RuntimeEventBus } from "@agent-core/events"
import { MemorySessionPersistence, Sessions, type SessionPersistence } from "@agent-core/session"

/**
 * The engine's dependency surface: the three collaborators a loop cannot be
 * written without. Everything an agent's tools happen to need — a file tree, a
 * skill catalogue, other agents — reaches them through the closures they were
 * built with, not through here.
 */
export type EngineDeps = {
  config: CoreConfig
  sessions: Sessions
  events: RuntimeEventBus
}

/**
 * Builds a self-contained EngineDeps — the named default an embedder gets when
 * it injects nothing: DEFAULT_CORE_CONFIG under any overrides, a private event
 * bus, and sessions on the injected persistence (in-memory when none is
 * given). A composition root with richer collaborators assembles its own
 * EngineDeps and injects that instead.
 *
 * @param options - config overrides, an external bus to observe on, and the
 *   storage backend the sessions live in
 * @returns a ready dependency set for createAgent
 */
export function createEngineDeps(options?: {
  config?: Partial<CoreConfig>
  events?: RuntimeEventBus
  persistence?: SessionPersistence
}): EngineDeps {
  const config: CoreConfig = { ...DEFAULT_CORE_CONFIG, ...(options?.config ?? {}) }
  const events = options?.events ?? createRuntimeEvents()
  const persistence = options?.persistence ?? new MemorySessionPersistence()
  return { config, events, sessions: new Sessions(persistence, events.state) }
}

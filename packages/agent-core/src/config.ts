/**
 * The engine's own knobs: what a loop needs to bound a turn and persist a
 * session. Nothing about files, skills, or delegation — those are the
 * orchestration layer's, and its config type extends this one.
 */
import type { SessionPersistenceConfig } from "@agent-core/session/persistence"

export type CoreConfig = {
  /** Assistant turns across a whole session, spanning every run in it. */
  session_max_steps: number
  turn_timeout_ms: number
  /** Total tool calls one run may make — a runaway guard. Per-turn fan-out is tool_max_concurrency. */
  run_max_tool_calls: number
  tool_max_concurrency: number
} & SessionPersistenceConfig

/** What a standalone agent runs on when its embedder says nothing. */
export const DEFAULT_CORE_CONFIG: CoreConfig = {
  session_max_steps: 100,
  turn_timeout_ms: 300_000,
  run_max_tool_calls: 32,
  tool_max_concurrency: 4,
  session_store: "memory",
  session_store_dir: "./data/sessions",
}

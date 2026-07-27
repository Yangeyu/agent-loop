import { z } from "zod"
import type { SessionPersistenceConfig } from "@harness/session/persistence"

// Shared with the retry middleware, so its default and the config default are
// one number rather than two that agree today.
export const RETRY_DEFAULTS = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 4000 }
export const COMPACTION_DEFAULTS = { triggerRatio: 0.75, retainRatio: 0.5 }

const ConfigSchema = z.object({
  session_store: z.enum(["memory", "file"]).default("memory"),
  session_store_dir: z.string().default("./data/sessions"),
  // The directory the file tools resolve relative paths against. Defaults to the
  // process directory, which is the one place `cwd` is allowed to enter — tools
  // read it from the workspace, never from the process.
  workspace_root: z.string().default("."),
  // Workspace skills directory, resolved against the working directory like the
  // read/write/bash tools are. Built-in skills ship with the code; these travel
  // with the workspace, so an absent default directory just means "none".
  skills_dir: z.string().default("./skills"),
  model_max_retries: z.coerce.number().int().min(0).default(RETRY_DEFAULTS.maxRetries),
  model_retry_base_delay_ms: z.coerce.number().int().min(1).default(RETRY_DEFAULTS.baseDelayMs),
  model_retry_max_delay_ms: z.coerce.number().int().min(1).default(RETRY_DEFAULTS.maxDelayMs),
  // Assistant turns across a whole session, spanning every run in it. A single
  // long deliverable can spend a run's worth of steps, so this sits well above
  // any one agent's cap rather than being the thing that cuts a run short.
  session_max_steps: z.coerce.number().int().min(1).default(100),
  subagent_max_depth: z.coerce.number().int().min(0).default(2),
  turn_timeout_ms: z.coerce.number().int().min(1).default(300000),
  // Total tool calls one agent run may make (see TurnBudgetPolicy.maxRunToolCalls).
  // A single document-producing run spends a dozen calls before it writes a line,
  // so this is a runaway guard, not a per-turn fan-out limit — that is
  // tool_max_concurrency.
  run_max_tool_calls: z.coerce.number().int().min(1).default(32),
  tool_max_concurrency: z.coerce.number().int().min(1).default(4),
  compaction_trigger_ratio: z.coerce.number().gt(0).max(1).default(COMPACTION_DEFAULTS.triggerRatio),
  compaction_retain_ratio: z.coerce.number().gt(0).lt(1).default(COMPACTION_DEFAULTS.retainRatio),
})

/**
 * The engine's own knobs: what a loop needs to bound a turn and persist a
 * session, and nothing about what the orchestration layer happens to do with
 * files, skills, or delegation.
 */
export type CoreConfig = Pick<
  z.infer<typeof ConfigSchema>,
  "session_max_steps" | "turn_timeout_ms" | "run_max_tool_calls" | "tool_max_concurrency"
> &
  SessionPersistenceConfig

/** The orchestration layer's config: the engine's, plus what the bricks need. */
export type Config = z.infer<typeof ConfigSchema> & SessionPersistenceConfig

let cachedConfig: Config | undefined

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    session_store: env.SESSION_STORE,
    session_store_dir: env.SESSION_STORE_DIR,
    workspace_root: env.WORKSPACE_ROOT,
    skills_dir: env.SKILLS_DIR,
    model_max_retries: env.MODEL_MAX_RETRIES,
    model_retry_base_delay_ms: env.MODEL_RETRY_BASE_DELAY_MS,
    model_retry_max_delay_ms: env.MODEL_RETRY_MAX_DELAY_MS,
    session_max_steps: env.SESSION_MAX_STEPS,
    subagent_max_depth: env.SUBAGENT_MAX_DEPTH,
    turn_timeout_ms: env.TURN_TIMEOUT_MS,
    run_max_tool_calls: env.RUN_MAX_TOOL_CALLS,
    tool_max_concurrency: env.TOOL_MAX_CONCURRENCY,
    compaction_trigger_ratio: env.COMPACTION_TRIGGER_RATIO,
    compaction_retain_ratio: env.COMPACTION_RETAIN_RATIO,
  })
}

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig
  cachedConfig = loadConfigFromEnv()
  return cachedConfig
}

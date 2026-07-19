import { z } from "zod"
import type { SessionPersistenceConfig } from "@harness/session/persistence"

const ConfigSchema = z.object({
  session_store: z.enum(["memory", "file"]).default("memory"),
  session_store_dir: z.string().default("./data/sessions"),
  model_max_retries: z.coerce.number().int().min(0).default(2),
  model_retry_base_delay_ms: z.coerce.number().int().min(1).default(500),
  model_retry_max_delay_ms: z.coerce.number().int().min(1).default(4000),
  session_max_steps: z.coerce.number().int().min(1).default(24),
  subagent_max_depth: z.coerce.number().int().min(0).default(2),
  turn_timeout_ms: z.coerce.number().int().min(1).default(300000),
  turn_max_tool_calls: z.coerce.number().int().min(1).default(8),
  tool_max_concurrency: z.coerce.number().int().min(1).default(4),
  compaction_trigger_ratio: z.coerce.number().gt(0).max(1).default(0.75),
  compaction_retain_ratio: z.coerce.number().gt(0).lt(1).default(0.5),
})

export type Config = z.infer<typeof ConfigSchema> & SessionPersistenceConfig

let cachedConfig: Config | undefined

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    session_store: env.SESSION_STORE,
    session_store_dir: env.SESSION_STORE_DIR,
    model_max_retries: env.MODEL_MAX_RETRIES,
    model_retry_base_delay_ms: env.MODEL_RETRY_BASE_DELAY_MS,
    model_retry_max_delay_ms: env.MODEL_RETRY_MAX_DELAY_MS,
    session_max_steps: env.SESSION_MAX_STEPS,
    subagent_max_depth: env.SUBAGENT_MAX_DEPTH,
    turn_timeout_ms: env.TURN_TIMEOUT_MS,
    turn_max_tool_calls: env.TURN_MAX_TOOL_CALLS,
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

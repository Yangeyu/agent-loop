// Public API barrel for the agent harness (engine).
// Surfaces (cli/tui/backend) should import from "@harness" rather than reaching
// into internal file paths, so this barrel is the engine's public contract.

// Runtime composition + lifecycle
export {
  createRuntime,
  createTestRuntime,
  disposeRuntime,
  runPrompt,
} from "@harness/runtime/bootstrap"
export type { RuntimeContext } from "@harness/runtime/context"
export type { RuntimeEvent } from "@harness/runtime/events"
export { attachConsoleLogger } from "@harness/runtime/logger"
export type { OutputMode } from "@harness/runtime/logger"

// Plugins / modules
export { corePlugin, coreModule } from "@harness/module"
export type { RuntimePlugin } from "@harness/plugin/types"

// Config
export { loadConfigFromEnv, getConfig, resetConfig } from "@harness/config"
export type { Config } from "@harness/config"

// Session
export { SessionPrompt } from "@harness/session/prompt"
export { SessionCompaction } from "@harness/session/compaction"
export type { ISessionStore } from "@harness/session/store/types"

// Tools
export { defineTool } from "@harness/tool/tool"
export type { TaskArgs, TaskResumeArgs } from "@harness/tool/task"

// Skills
export type { SkillInfo } from "@harness/skill/types"

// LLM
export { resolveModelSpec } from "@harness/llm/models"

// Utilities
export { loadText } from "@harness/lib/load-text"

// Shared runtime types (AgentInfo, SessionInfo, createID, message/part types, …)
export * from "@harness/types"

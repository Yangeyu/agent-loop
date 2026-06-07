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
export type { RuntimeContext, RuntimeDeps } from "@harness/runtime/context"
export type { RuntimeEvent } from "@harness/runtime/events"
export { attachConsoleLogger } from "@harness/runtime/logger"
export type { OutputMode } from "@harness/runtime/logger"

// Engine entry
export { runSession, runLoop } from "@harness/core/loop"

// Plugins / modules
export { corePlugin, coreModule } from "@harness/module"
export type { RuntimePlugin } from "@harness/plugin/types"

// Config
export { loadConfigFromEnv, getConfig, resetConfig } from "@harness/config"
export type { Config } from "@harness/config"

// Agents (blueprints): definition + composition helpers
export { defineAgent } from "@harness/agent/types"
export type { AgentDefinition, AgentSpec } from "@harness/agent/types"
export { coreAgents } from "@harness/agent"
export { baseMiddleware } from "@harness/agent/shared/base-middleware"
export type { ModelSelector, ModelProvider, ModelCaller } from "@harness/agent/model"

// Middleware library + hook contracts
export {
  contextAssembly,
  structuredOutput,
  budget,
  doomLoop,
  repeatedFailure,
  compaction,
} from "@harness/middleware"
export type {
  HookContext,
  Middleware,
  MiddlewareFactory,
  ToolCall,
  ToolGate,
  TurnGate,
  TurnOutcome,
  FinishDecision,
} from "@harness/hooks/types"

// Session store
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

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
export type { EventChannel, RuntimeEventBus } from "@harness/runtime/events"
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

// Middleware library + hook contracts
export {
  contextAssembly,
  structuredOutput,
  budget,
  doomLoop,
  repeatedFailure,
  compaction,
  viewImage,
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

// Sessions: the aggregate (single writer of session state) + persistence contract
export { Sessions } from "@harness/session"
export type { SessionPersistence } from "@harness/session"

// Tools
export { defineTool } from "@harness/tool/tool"
export type { TaskArgs, TaskResumeArgs } from "@harness/tool/task"

// Skills
export type { SkillInfo } from "@harness/skill/types"

// LLM: the Model abstraction + provider model factories
export { createDashScopeModel, createOpenAICompatModel } from "@harness/llm/index"
export type { Model, ModelCapabilities, ProviderModelSpec, DashScopeConfig, OpenAICompatModelConfig } from "@harness/llm/index"

// Utilities
export { loadText } from "@harness/lib/load-text"

// Shared runtime types (AgentInfo, SessionInfo, createID, message/part types, …)
export * from "@harness/types"

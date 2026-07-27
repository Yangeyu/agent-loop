// Public API barrel for the agent harness (engine).
// Surfaces (cli/tui) should import from "@harness" rather than reaching
// into internal file paths, so this barrel is the engine's public contract.

// Runtime composition + lifecycle
export {
  createRuntime,
  createTestRuntime,
  runPrompt,
} from "@harness/runtime/bootstrap"
export type { RuntimeAssembly } from "@harness/runtime/bootstrap"
export type { RuntimeContext } from "@harness/runtime/context"
export type { EventChannel, RuntimeEventBus } from "@harness/event/bus"

// Engine entry
export { runSession } from "@harness/agent/loop"

// Config
export { loadConfigFromEnv, getConfig } from "@harness/config"
export type { Config } from "@harness/config"

// The agent kernel: blueprint + the standalone runnable atom
export { defineAgent } from "@harness/agent/blueprint"
export type { AgentDefinition, AgentSpec } from "@harness/agent/blueprint"
export { createAgent } from "@harness/agent/create-agent"
export type { StandaloneAgentSpec } from "@harness/agent/create-agent"
export { createCoreAgents, createGeneralAgent, createLeadAgent } from "@harness/std/agents"
export { baseMiddleware } from "@harness/std/agents/shared/base-middleware"

// Middleware library + hook contracts. Middleware that also contributes a prompt
// fragment exports both halves (budget/stepGuidance, structuredOutput/…Prompt).
export {
  createRetry,
  promptAssembly,
  structuredOutput,
  structuredOutputPrompt,
  budget,
  stepGuidance,
  doomLoop,
  createCompaction,
  viewImage,
  type RetryOptions,
} from "@harness/std/middleware"

// Prompt composition: the shared slot vocabulary. Every fragment itself lives
// with its owner — see engineConventions (agents/shared), availableSkills
// (tools/skill), subagentList (tools/task).
export { SLOT_ORDER } from "@harness/std/prompt"
export type { PromptContributor, PromptSlot, SystemSection } from "@harness/std/prompt"
export { engineConventions } from "@harness/std/agents/shared/base-prompt"
export { availableSkills } from "@harness/std/tools/skill"
export { subagentList } from "@harness/std/tools/task"
export type {
  ContextDraft,
  HookContext,
  Middleware,
  MiddlewareFactory,
  ToolCall,
  ToolGate,
  ToolOutcome,
  TurnGate,
  TurnJudgment,
  TurnOutcome,
  TurnTerminal,
} from "@harness/agent/hooks"

// Sessions: the aggregate (single writer of session state) + persistence contract
export { Sessions } from "@harness/session"
export type { SessionPersistence } from "@harness/session"

// Tools
export { defineTool } from "@harness/tool/tool"
export { createCoreTools } from "@harness/std/tools"
export type { TaskArgs, TaskResumeArgs } from "@harness/std/tools/task"

// Skills: the data contract + the filesystem discovery brick (SKILL.md dirs)
export type { SkillInfo } from "@harness/skill/types"
export { loadSkillFile, loadSkillsFromDir } from "@harness/std/skills/load"

// LLM: the Model abstraction + provider model factories
export { createDashScopeModel, createOpenAICompatModel } from "@harness/llm/index"
export type { Model, ModelCapabilities, ProviderModelSpec, DashScopeConfig, OpenAICompatModelConfig } from "@harness/llm/index"

// Utilities

// Shared runtime types (AgentInfo, SessionInfo, createID, message/part types, …)
export * from "@harness/types"

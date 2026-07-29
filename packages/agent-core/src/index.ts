/**
 * Public API of the agent loop: drive one agent through turns until an outcome
 * breaks, streaming into a session and dispatching the tools that agent holds.
 *
 * It does not know what a skill is, where the files are, or that more than one
 * agent might exist — those belong to whatever orchestrates it (@harness is the
 * first such consumer). Everything a consumer adds arrives through two
 * contracts, middleware and tools, neither of which requires editing this
 * package.
 */

// The loop, behind its one door: createAgent
export { createAgent } from "@agent-core/create-agent"
export type { Agent, AgentRunInput, CreateAgentSpec } from "@agent-core/create-agent"
export { createEngineDeps } from "@agent-core/context"
export type { EngineDeps } from "@agent-core/context"

// The agent blueprint
export { defineAgent } from "@agent-core/blueprint"
export type { AgentDefinition, AgentSpec } from "@agent-core/blueprint"

// Middleware: the transform/decision layer
export { MiddlewareStack } from "@agent-core/hooks"
export type {
  ActivityEmitter,
  ActivityHandle,
  ContextDraft,
  HookContext,
  Middleware,
  MiddlewareFactory,
  ModelCallResult,
  RunContext,
  RunSummary,
  StackContext,
  ToolCall,
  ToolGate,
  ToolOutcome,
  TurnGate,
  TurnJudgment,
  TurnOutcome,
  TurnOutcomeReason,
  TurnTerminal,
} from "@agent-core/hooks"

// Execution bounds, resolved per turn and enforced by middleware
export { createTurnAbortSignal, isFinalAllowedStep, resolveTurnExecutionPolicy } from "@agent-core/policy"
export type { TimeoutPolicy, TurnBudgetPolicy, TurnExecutionPolicy } from "@agent-core/policy"

// Config: the engine's knobs. A consumer's config type extends CoreConfig.
export { DEFAULT_CORE_CONFIG } from "@agent-core/config"
export type { CoreConfig } from "@agent-core/config"

// Tools
export { defineTool, ToolExecutionError } from "@agent-core/tool/tool"
export { createToolContext } from "@agent-core/tool/fake-context"

// Sessions: the aggregate (single writer of session state), the storage
// contract, and the in-memory default. Real backends are injected instances.
export { MemorySessionPersistence, Sessions } from "@agent-core/session"
export type { SessionPersistence } from "@agent-core/session"

// Events: the two-channel observation bus
export { createRuntimeEvents } from "@agent-core/event/bus"
export type { EventChannel, RuntimeEventBus } from "@agent-core/event/bus"

// The model port + the providers that satisfy it
export { createDashScopeModel, createFakeModel, createOpenAICompatModel } from "@agent-core/llm/index"
export type {
  DashScopeConfig,
  FakeModelOptions,
  LLMChunk,
  LLMInput,
  Model,
  ModelCapabilities,
  ModelContentBlock,
  ModelMessage,
  OpenAICompatModelConfig,
  ProviderModelSpec,
} from "@agent-core/llm/index"
export { resolveImageSource } from "@agent-core/llm/index"
export { toModelMessages } from "@agent-core/llm/message"
export { classifyRetry } from "@agent-core/llm/classify"
export type { RetryCategory, RetryClassification } from "@agent-core/llm/classify"

// Failure normalization
export { isAbortError, toErrorInfo } from "@agent-core/error"

// The data model + event vocabulary: messages, parts, sessions, the reducer
export * from "@agent-core/types"
export { applyStateEvent, emptyProjection } from "@agent-core/model"
export type { SessionProjection } from "@agent-core/model"

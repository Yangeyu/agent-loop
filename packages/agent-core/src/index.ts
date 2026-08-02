/**
 * Public API of the agent loop: drive one agent through steps until an outcome
 * breaks, streaming into a session and dispatching the tools that agent holds.
 *
 * It does not know what a skill is, where the files are, or that more than one
 * agent might exist — those belong to whatever orchestrates it (@harness is the
 * first such consumer). Everything a consumer adds arrives through two
 * contracts, middleware and tools, neither of which requires editing this
 * package. The machinery under engine/ is not part of this surface and never
 * appears here.
 */

// The agent, behind its one door: createAgent
export { createAgent } from "@agent-core/agent"
export type { Agent, AgentDefinition, AgentRunInput, CreateAgentSpec } from "@agent-core/agent"
export { createEngineDeps } from "@agent-core/context"
export type { EngineDeps } from "@agent-core/context"

// Middleware: the transform/decision port
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
  StepGate,
  StepJudgment,
  StepOutcome,
  StepOutcomeReason,
  StepTerminal,
} from "@agent-core/hooks"

// Execution bounds, resolved per step and enforced by middleware
export { createStepAbortSignal, isFinalAllowedStep, resolveStepExecutionPolicy } from "@agent-core/policy"
export type { TimeoutPolicy, StepBudgetPolicy, StepExecutionPolicy } from "@agent-core/policy"

// Config: the engine's knobs. A consumer's config type extends CoreConfig.
export { DEFAULT_CORE_CONFIG } from "@agent-core/config"
export type { CoreConfig } from "@agent-core/config"

// The tool port: the contract, the factory, and the shipped test double
export { defineTool, ToolExecutionError } from "@agent-core/tool/tool"
export type {
  AnyToolDefinition,
  SessionHistoryMessage,
  ToolContext,
  ToolDefinition,
  ToolExecuteResult,
} from "@agent-core/tool/tool"
export { createToolContext } from "@agent-core/tool/fake-context"

// Sessions: the aggregate (single writer of session state), the storage
// contract, and the in-memory default. Real backends are injected instances.
export { MemorySessionPersistence, Sessions } from "@agent-core/session"
export type { SessionPersistence } from "@agent-core/session"

// Events: the two-channel observation bus
export { createRuntimeEvents } from "@agent-core/events"
export type { EventChannel, RuntimeEventBus } from "@agent-core/events"

// The model port: the stream protocol, the session -> messages projection,
// failure classification, and the shipped fake. Concrete providers live in
// @providers and are injected as bound Model instances.
export { DEFAULT_TEMPERATURE } from "@agent-core/llm/types"
export type {
  LLMChunk,
  LLMInput,
  LLMStreamResult,
  Model,
  ModelCapabilities,
  ModelContentBlock,
  ModelMessage,
  ProviderModelSpec,
} from "@agent-core/llm/types"
export { serializeContentBlocks, toModelMessages } from "@agent-core/llm/message"
export { classifyRetry } from "@agent-core/llm/classify"
export type { RetryCategory, RetryClassification } from "@agent-core/llm/classify"
export { createFakeModel } from "@agent-core/llm/fake"
export type { FakeModelOptions } from "@agent-core/llm/fake"

// Failure normalization
export { isAbortError, toErrorInfo } from "@agent-core/error"

// The data model + event vocabulary: messages, parts, sessions, the reducer
export * from "@agent-core/model"

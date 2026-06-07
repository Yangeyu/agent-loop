// Lifecycle hook contracts. Middleware is the transform/decision layer that can
// rewrite context, gate tool calls, and shape turn outcomes. It is distinct from
// the read-only event bus (runtime/events.ts), which remains the observation layer.
import type { AgentRegistry } from "@harness/agent/registry"
import type { ModelCaller } from "@harness/agent/model"
import type { AgentDefinition } from "@harness/agent/types"
import type { Config } from "@harness/config"
import type { ModelMessage } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/core/policy"
import type { RuntimeEventBus } from "@harness/runtime/events"
import type { SkillRegistry } from "@harness/skill/registry"
import type { ISessionStore } from "@harness/session/store"
import type { ToolRegistry } from "@harness/tool/registry"
import type { ErrorInfo, FinishReason, OutputFormat, ToolExecuteResult, TurnOutcomeReason } from "@harness/types"

export type HookContext = {
  config: Config
  session_store: ISessionStore
  events: RuntimeEventBus
  agent_registry: AgentRegistry
  skill_registry: SkillRegistry
  tool_registry: ToolRegistry
  agent: AgentDefinition
  sessionID: string
  messageID: string
  turnID: string
  step: number
  policy: TurnExecutionPolicy
  abort: AbortSignal
  // The structured-output format requested for this turn (from the user message).
  format?: OutputFormat
  // System fragments assembled for this turn. Populated before transformMessages
  // runs, so transform middleware (e.g. compaction) can measure system + messages.
  system: string[]
  // The current agent's bound model caller. Used by middleware that must call the
  // model directly (e.g. compaction) — bypasses the stack to avoid re-entrancy.
  llm: ModelCaller
}

export type ToolCall = {
  toolName: string
  toolCallId: string
  args: unknown
}

export type TurnGate =
  | { proceed: true }
  | { proceed: false; reason: TurnOutcomeReason; note?: string }

export type ToolGate =
  | { action: "proceed"; args?: unknown }
  | { action: "deny"; error: ErrorInfo; note?: string }

export type ToolErrorDecision =
  | { action: "continue" }
  | { action: "stop"; error: ErrorInfo; note?: string }

export type TurnFinishInfo = {
  finishReason: FinishReason
  // The non-synthetic assistant text accumulated this turn.
  text: string
}

export type FinishDecision =
  | { ok: true; structured?: unknown }
  | { ok: false; error: ErrorInfo }

export type TurnOutcome =
  | { kind: "continue"; reason: TurnOutcomeReason }
  | { kind: "break"; reason: TurnOutcomeReason; note?: string }

export type Middleware = {
  name: string
  // Context assembly (ordered)
  contributeSystem?(ctx: HookContext): string[] | Promise<string[]>
  transformMessages?(ctx: HookContext, messages: ModelMessage[]): ModelMessage[] | Promise<ModelMessage[]>
  // Turn lifecycle
  beforeTurn?(ctx: HookContext): TurnGate | Promise<TurnGate>
  onTurnFinish?(ctx: HookContext, finish: TurnFinishInfo): FinishDecision | Promise<FinishDecision>
  resolveOutcome?(ctx: HookContext, outcome: TurnOutcome): TurnOutcome | Promise<TurnOutcome>
  // Tool lifecycle
  beforeToolCall?(ctx: HookContext, call: ToolCall): ToolGate | Promise<ToolGate>
  afterToolCall?(ctx: HookContext, call: ToolCall, result: ToolExecuteResult): ToolExecuteResult | Promise<ToolExecuteResult>
  onToolError?(ctx: HookContext, call: ToolCall, error: ErrorInfo): ToolErrorDecision | Promise<ToolErrorDecision>
}

// Instantiated once per AgentRun (loop), so a middleware can hold loop-scoped
// state in closures (doom-loop history, failure counters, budget counters).
export type MiddlewareFactory = () => Middleware

// Lifecycle hook contracts. Middleware is the transform/decision layer that can
// rewrite context, gate tool calls, and shape turn outcomes. It is distinct from
// the event bus (runtime/events.ts), which is observation only.
//
// HookContext is immutable from a middleware's point of view: state flows back
// to the engine through hook return values, never by assigning context fields.
// Session state is reached through `ctx.sessions` (the single-writer aggregate);
// telemetry is emitted on `ctx.events.loop`.
import type { AgentRegistry } from "@harness/agent/registry"
import type { AgentDefinition } from "@harness/agent/types"
import type { Config } from "@harness/config"
import type { Model, ModelMessage } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/core/policy"
import type { RuntimeEventBus } from "@harness/runtime/events"
import type { SkillRegistry } from "@harness/skill/registry"
import type { Sessions } from "@harness/session"
import type { ToolRegistry } from "@harness/tool/registry"
import type { ErrorInfo, FinishReason, OutputFormat, ToolExecuteResult, TurnOutcomeReason } from "@harness/types"

export type HookContext = {
  readonly config: Config
  readonly sessions: Sessions
  readonly events: RuntimeEventBus
  readonly agent_registry: AgentRegistry
  readonly skill_registry: SkillRegistry
  readonly tool_registry: ToolRegistry
  readonly agent: AgentDefinition
  readonly sessionID: string
  // The root of this session's delegation tree, for loop-event envelopes.
  readonly rootID: string
  // This turn's assistant message — the record every turn-scoped hook reads or patches.
  readonly messageID: string
  readonly step: number
  readonly policy: TurnExecutionPolicy
  readonly abort: AbortSignal
  // The structured-output format requested for this turn (from the user message).
  readonly format?: OutputFormat
  // The current agent's bound model instance. Read by gating middleware for its
  // spec (capabilities/contextWindow); also callable directly for out-of-band
  // single-shot calls that must bypass the stack to avoid re-entrancy.
  readonly model: Model
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

// Hooks are grouped below by phase, NOT by runtime order. The actual per-turn
// firing sequence is beforeTurn → contributeSystem → transformMessages → (stream
// + tool hooks) → onTurnFinish → resolveOutcome; see core/loop.ts for the map.
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

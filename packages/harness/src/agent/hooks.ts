// Lifecycle hook contracts + dispatch. Middleware is the transform/decision
// layer that can rewrite context, gate tool calls, and shape turn outcomes. It
// is distinct from the event bus (event/bus.ts), which is observation only.
//
// HookContext is immutable from a middleware's point of view: state flows back
// to the engine through hook return values, never by assigning context fields.
// Session state is reached through `ctx.sessions` (the single-writer aggregate).
import type { AgentDefinition } from "@harness/agent/blueprint"
import type { Config } from "@harness/config"
import type { Model, ModelMessage } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/agent/policy"
import type { RuntimeEventBus } from "@harness/event/bus"
import type { SkillInfo } from "@harness/skill/types"
import type { Sessions } from "@harness/session"
import type { ErrorInfo, FinishReason, OutputFormat, ToolExecuteResult } from "@harness/types"

// Why a turn's outcome was shaped the way it was — the hook-layer vocabulary
// middleware uses to gate turns and resolve continue/break decisions.
export type TurnOutcomeReason =
  | "tool_calls"
  | "empty_assistant"
  | "context_limit"
  | "structured_output"
  | "step_budget_reached"
  | "step_budget_reached_without_answer"
  | "assistant_error"
  | "final_text"
  | "completed_without_output"

export type HookContext = {
  readonly config: Config
  readonly sessions: Sessions
  readonly events: RuntimeEventBus
  // Read-only lookups middleware actually uses: agent listing (delegation
  // prompts) and skill listing (context assembly). Structural on purpose — the
  // hook contract names only the capability, not the registry implementation.
  // Tool resolution is an engine/tool-context concern and deliberately absent.
  readonly agent_registry: { list(): AgentDefinition[] }
  readonly skill_registry: { list(): SkillInfo[] }
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

// The model input under assembly for one turn: system fragments plus the
// transformed message history. Each middleware receives the draft so far and
// returns the next one (append system fragments, rewrite messages, or both).
export type ContextDraft = {
  system: string[]
  messages: ModelMessage[]
}

// One settled tool call, success or failure, flowing through afterToolCall.
// A middleware may rewrite the result, replace the error, or — on a failure —
// escalate with `stop: true` to halt the turn (note lands on the transcript).
export type ToolOutcome =
  | { ok: true; result: ToolExecuteResult }
  | { ok: false; error: ErrorInfo; stop?: boolean; note?: string }

// The terminal the engine applies when a turn finishes cleanly: keep the model's
// finish (optionally overriding the recorded reason or attaching structured
// output), or fail the turn.
export type TurnTerminal =
  | { ok: true; structured?: unknown; finishReason?: FinishReason }
  | { ok: false; error: ErrorInfo }

export type TurnOutcome =
  | { kind: "continue"; reason: TurnOutcomeReason }
  | { kind: "break"; reason: TurnOutcomeReason; note?: string }

// The single end-of-turn judgment. `finish` describes how the model turn ended
// (finishReason absent when the turn already terminated inside the run — tool
// stop, abort, or stream failure). `terminal` is open for amendment only on a
// clean finish; the engine applies it exactly once after the stack settles.
// `outcome` decides whether the loop continues.
export type TurnJudgment = {
  readonly finish: { readonly finishReason?: FinishReason; readonly text: string }
  readonly terminal?: TurnTerminal
  readonly outcome: TurnOutcome
}

// Hooks are grouped below by phase, NOT by runtime order. The actual per-turn
// firing sequence is beforeTurn → assembleContext → (stream + beforeToolCall /
// afterToolCall per tool call) → judgeTurn; see agent/loop.ts for the map.
export type Middleware = {
  name: string
  // Context assembly: the draft flows through the stack in registration order.
  assembleContext?(ctx: HookContext, draft: ContextDraft): ContextDraft | Promise<ContextDraft>
  // Gates: the first refusal short-circuits the stack.
  beforeTurn?(ctx: HookContext): TurnGate | Promise<TurnGate>
  beforeToolCall?(ctx: HookContext, call: ToolCall): ToolGate | Promise<ToolGate>
  // Tool settlement: success and failure share the entry; first stop wins.
  afterToolCall?(ctx: HookContext, call: ToolCall, outcome: ToolOutcome): ToolOutcome | Promise<ToolOutcome>
  // End-of-turn judgment: terminal + loop continuation, folded left; later
  // middleware sees (and may amend) the judgment so far.
  judgeTurn?(ctx: HookContext, judgment: TurnJudgment): TurnJudgment | Promise<TurnJudgment>
}

// Instantiated once per AgentRun (loop), so a middleware can hold loop-scoped
// state in closures (doom-loop history, failure counters, budget counters).
export type MiddlewareFactory = () => Middleware

// MiddlewareStack: ordered dispatch over a loop-scoped set of middleware.
// Dispatch semantics per hook: assembleContext and judgeTurn fold left (each
// middleware sees the value so far); beforeTurn first stop short-circuits;
// beforeToolCall first deny short-circuits (args thread through); afterToolCall
// folds left with the first stop short-circuiting.
export class MiddlewareStack {
  private constructor(private readonly middleware: Middleware[]) {}

  static build(factories: MiddlewareFactory[]): MiddlewareStack {
    return new MiddlewareStack(factories.map((factory) => factory()))
  }

  async assembleContext(ctx: HookContext, draft: ContextDraft): Promise<ContextDraft> {
    let current = draft
    for (const middleware of this.middleware) {
      if (!middleware.assembleContext) continue
      current = await middleware.assembleContext(ctx, current)
    }
    return current
  }

  async beforeTurn(ctx: HookContext): Promise<TurnGate> {
    for (const middleware of this.middleware) {
      if (!middleware.beforeTurn) continue
      const gate = await middleware.beforeTurn(ctx)
      if (!gate.proceed) return gate
    }
    return { proceed: true }
  }

  async beforeToolCall(ctx: HookContext, call: ToolCall): Promise<ToolGate> {
    let args = call.args
    for (const middleware of this.middleware) {
      if (!middleware.beforeToolCall) continue
      const gate = await middleware.beforeToolCall(ctx, { ...call, args })
      if (gate.action === "deny") return gate
      if (gate.args !== undefined) args = gate.args
    }
    return { action: "proceed", args }
  }

  async afterToolCall(ctx: HookContext, call: ToolCall, outcome: ToolOutcome): Promise<ToolOutcome> {
    let current = outcome
    for (const middleware of this.middleware) {
      if (!middleware.afterToolCall) continue
      current = await middleware.afterToolCall(ctx, call, current)
      if (!current.ok && current.stop) return current
    }
    return current
  }

  async judgeTurn(ctx: HookContext, judgment: TurnJudgment): Promise<TurnJudgment> {
    let current = judgment
    for (const middleware of this.middleware) {
      if (!middleware.judgeTurn) continue
      current = await middleware.judgeTurn(ctx, current)
    }
    return current
  }
}

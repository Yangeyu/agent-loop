// Lifecycle hook contracts + dispatch. Middleware is the transform/decision
// layer that can rewrite context, wrap the model call, gate tool calls, and
// shape turn outcomes. It is distinct from the event bus (event/bus.ts), which
// is observation only.
//
// Hook names follow <position><Subject>, so the whole set reads in execution
// order instead of needing agent/loop.ts to disambiguate it:
//
//   beforeRun
//     ├─ ( beforeTurn                        gate + the one effect point
//     │    → beforeModelCall                 pure fold (ctx, draft) => draft
//     │    → wrapModelCall( one stream )     onion; retry lives here
//     │    → ( beforeToolCall → afterToolCall )*
//     │    → afterTurn )*                    terminal + loop continuation
//     └─ afterRun                            runs in a finally
//
// HookContext is immutable from a middleware's point of view: state flows back
// to the engine through hook return values, never by assigning context fields.
// Session state is reached through `ctx.sessions` (the single-writer aggregate).
import type { AgentDefinition } from "@harness/agent/blueprint"
import type { CoreConfig } from "@harness/config"
import type { LLMInput, Model, ModelMessage } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/agent/policy"
import type { Sessions } from "@harness/session"
import type { ErrorInfo, FinishReason, OutputFormat, ToolExecuteResult } from "@harness/types"

// Why a turn's outcome was shaped the way it was — the hook-layer vocabulary
// middleware uses to gate turns and resolve continue/break decisions.
//
// The engine's own five are named; the union stays open because the rest of
// this vocabulary belongs to middleware — "step_budget_reached" is the budget
// middleware's word, not a fact the kernel knows. Closing it would make every
// new middleware reason a kernel edit.
//
// Opening it costs nothing: this type never leaves the engine (a turn.end event
// carries TurnEndReason, a separate vocabulary), and the only branch on it
// anywhere reads one of the five below.
export type TurnOutcomeReason =
  | "tool_calls"
  | "empty_assistant"
  | "assistant_error"
  | "final_text"
  | "completed_without_output"
  | (string & {})

/** Run-scoped context: what holds still for the whole loop. */
export type RunContext = {
  readonly config: CoreConfig
  readonly sessions: Sessions
  readonly agent: AgentDefinition
  readonly sessionID: string
  // The run's root abort. Turn-scoped hooks see a narrower one (below).
  readonly abort: AbortSignal
  // The current agent's bound model instance. Read by gating middleware for its
  // spec (capabilities/contextWindow); also callable directly for out-of-band
  // single-shot calls that must bypass the stack to avoid re-entrancy.
  readonly model: Model
}

/** Turn-scoped context: the run context plus what this turn resolved. */
export type HookContext = RunContext & {
  // This turn's assistant message — the record every turn-scoped hook reads or patches.
  readonly messageID: string
  readonly step: number
  readonly policy: TurnExecutionPolicy
  // This turn's abort: the run's signal plus the turn timeout.
  readonly abort: AbortSignal
  // The structured-output format requested for this turn (from the user message).
  readonly format?: OutputFormat
  // Reports what this middleware is doing, as turn.activity loop events. The
  // stack binds the producer from `middleware.name`, so a caller never names
  // itself — and middleware get this narrow capability rather than the bus,
  // which keeps them the decision layer and the bus the observation layer.
  readonly activity: (input: { label: string; detail?: string }) => ActivityHandle
}

/** One reported activity, from `ctx.activity(...)` to its end. */
export type ActivityHandle = {
  update(detail: string): void
  // Idempotent, so try/finally is safe.
  end(detail?: string): void
}

/** The engine's half of `activity`: the same call with the producer named. */
export type ActivityEmitter = (input: { source: string; label: string; detail?: string }) => ActivityHandle

// What the engine hands the stack: a turn context whose activity has no producer
// yet. There is deliberately no unbound `activity` to call — an activity without
// a source is not a thing the engine can emit.
export type StackContext = Omit<HookContext, "activity"> & { readonly openActivity: ActivityEmitter }

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

// The product of one streamed model call: how it ended, and the tool calls it
// issued. The turn executes those calls *after* the wrapModelCall onion unwinds,
// which is what keeps "model call" and "tool batch" separable — a middleware
// that retries a failed stream can never replay tools that already ran.
export type ModelCallResult = {
  readonly finishReason?: FinishReason
  readonly toolCalls: readonly ToolCall[]
}

/** How the run ended, handed to afterRun so teardown can act on it. */
export type RunSummary = {
  readonly steps: number
  readonly reason: TurnOutcomeReason
}

// Declared in execution order — see the map at the top of this file.
export type Middleware = {
  name: string
  // Run setup: async initialization a factory's constructor cannot do. No gate:
  // refusing a run is refusing its first turn, which beforeTurn already does.
  beforeRun?(ctx: RunContext): void | Promise<void>
  // Turn gate and the stack's one sanctioned effect point (compaction rewrites
  // session history here). The first refusal short-circuits.
  beforeTurn?(ctx: HookContext): TurnGate | Promise<TurnGate>
  // Context assembly: the draft flows through the stack in registration order.
  beforeModelCall?(ctx: HookContext, draft: ContextDraft): ContextDraft | Promise<ContextDraft>
  // Onion around one streamed model call: rewrite the request, retry it, or
  // substitute a result. Earlier registration sits further out.
  wrapModelCall?(
    ctx: HookContext,
    request: LLMInput,
    next: (request: LLMInput) => Promise<ModelCallResult>,
  ): Promise<ModelCallResult>
  // Tool gate: the first refusal short-circuits.
  beforeToolCall?(ctx: HookContext, call: ToolCall): ToolGate | Promise<ToolGate>
  // Tool settlement: success and failure share the entry; first stop wins.
  afterToolCall?(ctx: HookContext, call: ToolCall, outcome: ToolOutcome): ToolOutcome | Promise<ToolOutcome>
  // End-of-turn judgment: terminal + loop continuation, folded left; later
  // middleware sees (and may amend) the judgment so far.
  afterTurn?(ctx: HookContext, judgment: TurnJudgment): TurnJudgment | Promise<TurnJudgment>
  // Run teardown, in a finally — the counterpart a middleware holding a resource
  // (subprocess, temp dir, connection) needs in order to release it.
  afterRun?(ctx: RunContext, summary: RunSummary): void | Promise<void>
}

// Instantiated once per AgentRun (loop), so a middleware can hold loop-scoped
// state in closures (doom-loop history, failure counters, budget counters).
export type MiddlewareFactory = () => Middleware

// MiddlewareStack: ordered dispatch over a loop-scoped set of middleware.
// Dispatch semantics per hook: beforeModelCall and afterTurn fold left (each
// middleware sees the value so far); beforeTurn first stop short-circuits;
// wrapModelCall composes as an onion with the first middleware outermost;
// beforeToolCall first deny short-circuits (args thread through); afterToolCall
// folds left with the first stop short-circuiting; beforeRun runs in order and
// afterRun in reverse, the usual setup/teardown pairing.
export class MiddlewareStack {
  private constructor(private readonly middleware: Middleware[]) {}

  static build(factories: MiddlewareFactory[]): MiddlewareStack {
    return new MiddlewareStack(factories.map((factory) => factory()))
  }

  async beforeRun(ctx: RunContext): Promise<void> {
    for (const middleware of this.middleware) {
      await middleware.beforeRun?.(ctx)
    }
  }

  async afterRun(ctx: RunContext, summary: RunSummary): Promise<void> {
    for (let index = this.middleware.length - 1; index >= 0; index -= 1) {
      await this.middleware[index].afterRun?.(ctx, summary)
    }
  }

  // Composed right-to-left so the first-registered middleware ends up outermost
  // — the same "earlier sees it first" rule the folding hooks follow.
  async wrapModelCall(
    ctx: StackContext,
    request: LLMInput,
    base: (request: LLMInput) => Promise<ModelCallResult>,
  ): Promise<ModelCallResult> {
    let next = base
    for (let index = this.middleware.length - 1; index >= 0; index -= 1) {
      const middleware = this.middleware[index]
      const wrap = middleware.wrapModelCall
      if (!wrap) continue
      const inner = next
      const scoped = this.scope(ctx, middleware)
      next = (input) => wrap.call(middleware, scoped, input, inner)
    }
    return next(request)
  }

  async beforeModelCall(ctx: StackContext, draft: ContextDraft): Promise<ContextDraft> {
    let current = draft
    for (const middleware of this.middleware) {
      if (!middleware.beforeModelCall) continue
      current = await middleware.beforeModelCall(this.scope(ctx, middleware), current)
    }
    return current
  }

  async beforeTurn(ctx: StackContext): Promise<TurnGate> {
    for (const middleware of this.middleware) {
      if (!middleware.beforeTurn) continue
      const gate = await middleware.beforeTurn(this.scope(ctx, middleware))
      if (!gate.proceed) return gate
    }
    return { proceed: true }
  }

  async beforeToolCall(ctx: StackContext, call: ToolCall): Promise<ToolGate> {
    let args = call.args
    for (const middleware of this.middleware) {
      if (!middleware.beforeToolCall) continue
      const gate = await middleware.beforeToolCall(this.scope(ctx, middleware), { ...call, args })
      if (gate.action === "deny") return gate
      if (gate.args !== undefined) args = gate.args
    }
    return { action: "proceed", args }
  }

  async afterToolCall(ctx: StackContext, call: ToolCall, outcome: ToolOutcome): Promise<ToolOutcome> {
    let current = outcome
    for (const middleware of this.middleware) {
      if (!middleware.afterToolCall) continue
      current = await middleware.afterToolCall(this.scope(ctx, middleware), call, current)
      if (!current.ok && current.stop) return current
    }
    return current
  }

  async afterTurn(ctx: StackContext, judgment: TurnJudgment): Promise<TurnJudgment> {
    let current = judgment
    for (const middleware of this.middleware) {
      if (!middleware.afterTurn) continue
      current = await middleware.afterTurn(this.scope(ctx, middleware), current)
    }
    return current
  }

  // Binds `activity` to this middleware's name. Derived per dispatch rather than
  // held, because the emitter underneath is turn-scoped.
  private scope(ctx: StackContext, middleware: Middleware): HookContext {
    return {
      ...ctx,
      activity: (input) => ctx.openActivity({ ...input, source: middleware.name }),
    }
  }
}

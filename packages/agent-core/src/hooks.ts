/**
 * Lifecycle hook contracts + dispatch. Middleware is the transform/decision
 * layer that can rewrite context, wrap the model call, gate tool calls, and
 * shape step outcomes. It is distinct from the event bus (events.ts), which
 * is observation only.
 *
 * Hook names follow <position><Subject>, so the set reads in execution order:
 *
 *   beforeRun
 *     ├─ ( beforeStep                        gate + the one effect point
 *     │    → beforeModelCall                 pure fold (ctx, draft) => draft
 *     │    → wrapModelCall( one stream )     onion; retry lives here
 *     │    → ( beforeToolCall → afterToolCall )*
 *     │    → afterStep )*                    terminal + loop continuation
 *     └─ afterRun                            runs in a finally
 *
 * HookContext is immutable from a middleware's point of view: state flows back
 * to the engine through hook return values, never by assigning context fields.
 * Session state is reached through `ctx.sessions` (the single-writer aggregate).
 */
import type { AgentDefinition } from "@agent-core/blueprint"
import type { CoreConfig } from "@agent-core/config"
import type { LLMInput, Model, ModelMessage } from "@agent-core/llm/types"
import type { StepExecutionPolicy } from "@agent-core/policy"
import type { Sessions } from "@agent-core/session"
import type { ErrorInfo, FinishReason, OutputFormat, ToolExecuteResult } from "@agent-core/types"

/**
 * Why a step ended the way it did — the vocabulary middleware use to gate steps
 * and resolve continue/break decisions. The loop names its own five; the union
 * stays open for middleware vocabulary ("step_budget_reached" is the budget
 * middleware's word).
 */
export type StepOutcomeReason =
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
  /** The run's root abort. Step-scoped hooks see a narrower one. */
  readonly abort: AbortSignal
  /**
   * The agent's bound model. Gating middleware read its spec; out-of-band
   * single-shot calls may call it directly, bypassing the stack.
   */
  readonly model: Model
}

/** Step-scoped context: the run context plus what this step resolved. */
export type HookContext = RunContext & {
  /** This step's assistant message — the record step-scoped hooks read and patch. */
  readonly messageID: string
  readonly step: number
  readonly policy: StepExecutionPolicy
  /** This step's abort: the run's signal plus the step timeout. */
  readonly abort: AbortSignal
  /** The structured-output format requested for this step. */
  readonly format?: OutputFormat
  /**
   * Reports what this middleware is doing, as step.activity loop events. The
   * stack binds the source from `middleware.name`.
   */
  readonly activity: (input: { label: string; detail?: string }) => ActivityHandle
}

/** One reported activity, from `ctx.activity(...)` to its end. */
export type ActivityHandle = {
  update(detail: string): void
  /** Idempotent, so try/finally is safe. */
  end(detail?: string): void
}

/** The engine's half of `activity`: the same call with the producer named. */
export type ActivityEmitter = (input: { source: string; label: string; detail?: string }) => ActivityHandle

/**
 * What the engine hands the stack: the step context with activity still
 * unbound. The stack names the source per middleware before dispatch.
 */
export type StackContext = Omit<HookContext, "activity"> & { readonly openActivity: ActivityEmitter }

export type ToolCall = {
  toolName: string
  toolCallId: string
  args: unknown
}

export type StepGate =
  | { proceed: true }
  | { proceed: false; reason: StepOutcomeReason; note?: string }

export type ToolGate =
  | { action: "proceed"; args?: unknown }
  | { action: "deny"; error: ErrorInfo; note?: string }

/**
 * The model input under assembly for one step: system fragments plus the
 * transformed message history. Each middleware receives the draft so far and
 * returns the next one.
 */
export type ContextDraft = {
  system: string[]
  messages: ModelMessage[]
}

/**
 * One settled tool call, success or failure, flowing through afterToolCall.
 * A middleware may rewrite the result, replace the error, or — on a failure —
 * escalate with `stop: true` to halt the step (note lands on the transcript).
 */
export type ToolOutcome =
  | { ok: true; result: ToolExecuteResult }
  | { ok: false; error: ErrorInfo; stop?: boolean; note?: string }

/**
 * The terminal the engine applies when a step finishes cleanly: keep the
 * model's finish (optionally overriding the recorded reason or attaching
 * structured output), or fail the step.
 */
export type StepTerminal =
  | { ok: true; structured?: unknown; finishReason?: FinishReason }
  | { ok: false; error: ErrorInfo }

export type StepOutcome =
  | { kind: "continue"; reason: StepOutcomeReason }
  | { kind: "break"; reason: StepOutcomeReason; note?: string }

/**
 * The single end-of-step judgment. `finish` describes how the model step ended
 * (finishReason absent when the step already terminated inside the run — tool
 * stop, abort, or stream failure). `terminal` is open for amendment only on a
 * clean finish; the engine applies it exactly once after the stack settles.
 * `outcome` decides whether the loop continues.
 */
export type StepJudgment = {
  readonly finish: { readonly finishReason?: FinishReason; readonly text: string }
  readonly terminal?: StepTerminal
  readonly outcome: StepOutcome
}

/**
 * The product of one streamed model call: how it ended, and the tool calls it
 * issued. The step executes those calls after the wrapModelCall onion unwinds,
 * so a middleware that retries a failed stream never replays executed tools.
 */
export type ModelCallResult = {
  readonly finishReason?: FinishReason
  readonly toolCalls: readonly ToolCall[]
}

/** How the run ended, handed to afterRun so teardown can act on it. */
export type RunSummary = {
  readonly steps: number
  readonly reason: StepOutcomeReason
}

/** The hook contract, declared in execution order — see the map at the top of this file. */
export type Middleware = {
  name: string
  /** Run setup: async initialization a factory's constructor cannot do. */
  beforeRun?(ctx: RunContext): void | Promise<void>
  /**
   * Step gate and the stack's one sanctioned effect point (compaction rewrites
   * session history here). The first refusal short-circuits.
   */
  beforeStep?(ctx: HookContext): StepGate | Promise<StepGate>
  /** Context assembly: the draft flows through the stack in registration order. */
  beforeModelCall?(ctx: HookContext, draft: ContextDraft): ContextDraft | Promise<ContextDraft>
  /**
   * Onion around one streamed model call: rewrite the request, retry it, or
   * substitute a result. Earlier registration sits further out.
   */
  wrapModelCall?(
    ctx: HookContext,
    request: LLMInput,
    next: (request: LLMInput) => Promise<ModelCallResult>,
  ): Promise<ModelCallResult>
  /** Tool gate: the first refusal short-circuits. */
  beforeToolCall?(ctx: HookContext, call: ToolCall): ToolGate | Promise<ToolGate>
  /** Tool settlement: success and failure share the entry; first stop wins. */
  afterToolCall?(ctx: HookContext, call: ToolCall, outcome: ToolOutcome): ToolOutcome | Promise<ToolOutcome>
  /**
   * End-of-step judgment: terminal + loop continuation, folded left; later
   * middleware sees (and may amend) the judgment so far.
   */
  afterStep?(ctx: HookContext, judgment: StepJudgment): StepJudgment | Promise<StepJudgment>
  /**
   * Run teardown, in a finally — where a middleware holding a resource
   * (subprocess, temp dir, connection) releases it.
   */
  afterRun?(ctx: RunContext, summary: RunSummary): void | Promise<void>
}

/**
 * Instantiated once per run, so a middleware can hold loop-scoped state in
 * closures (doom-loop history, failure counters, budget counters).
 */
export type MiddlewareFactory = () => Middleware

/**
 * Ordered dispatch over a loop-scoped set of middleware. Per hook:
 * beforeModelCall and afterStep fold left (each middleware sees the value so
 * far); beforeStep first stop short-circuits; wrapModelCall composes as an
 * onion with the first middleware outermost; beforeToolCall first deny
 * short-circuits (args thread through); afterToolCall folds left with the
 * first stop short-circuiting; beforeRun runs in order and afterRun in
 * reverse, the usual setup/teardown pairing.
 */
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

  async beforeStep(ctx: StackContext): Promise<StepGate> {
    for (const middleware of this.middleware) {
      if (!middleware.beforeStep) continue
      const gate = await middleware.beforeStep(this.scope(ctx, middleware))
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

  async afterStep(ctx: StackContext, judgment: StepJudgment): Promise<StepJudgment> {
    let current = judgment
    for (const middleware of this.middleware) {
      if (!middleware.afterStep) continue
      current = await middleware.afterStep(this.scope(ctx, middleware), current)
    }
    return current
  }

  // Binds `activity` to this middleware's name. Derived per dispatch rather than
  // held, because the emitter underneath is step-scoped.
  private scope(ctx: StackContext, middleware: Middleware): HookContext {
    return {
      ...ctx,
      activity: (input) => ctx.openActivity({ ...input, source: middleware.name }),
    }
  }
}

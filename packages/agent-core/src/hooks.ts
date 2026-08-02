/**
 * The middleware port: the lifecycle hook contracts. Middleware is the
 * transform/decision layer that can rewrite context, wrap the model call, gate
 * tool calls, and shape step outcomes. It is distinct from the event bus
 * (events.ts), which is observation only; the dispatch semantics live with the
 * machine (engine/stack.ts).
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
import type { AgentDefinition } from "@agent-core/agent"
import type { CoreConfig } from "@agent-core/config"
import type { LLMInput, Model, ModelMessage } from "@agent-core/llm/types"
import type { StepExecutionPolicy } from "@agent-core/policy"
import type { Sessions } from "@agent-core/session"
import type { ErrorInfo, FinishReason, OutputFormat } from "@agent-core/model"
import type { ToolExecuteResult } from "@agent-core/tool/tool"

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

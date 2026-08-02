/**
 * Ordered dispatch over a loop-scoped set of middleware. Per hook:
 * beforeModelCall and afterStep fold left (each middleware sees the value so
 * far); beforeStep first stop short-circuits; wrapModelCall composes as an
 * onion with the first middleware outermost; beforeToolCall first deny
 * short-circuits (args thread through); afterToolCall folds left with the
 * first stop short-circuiting; beforeRun runs in order and afterRun in
 * reverse, the usual setup/teardown pairing.
 */
import type {
  ActivityEmitter,
  ContextDraft,
  HookContext,
  Middleware,
  MiddlewareFactory,
  ModelCallResult,
  RunContext,
  RunStackContext,
  RunSummary,
  StackContext,
  StepGate,
  StepJudgment,
  ToolCall,
  ToolGate,
  ToolOutcome,
} from "@agent-core/hooks"
import type { LLMInput } from "@agent-core/llm/types"

export class MiddlewareStack {
  private constructor(private readonly middleware: Middleware[]) {}

  static build(factories: MiddlewareFactory[]): MiddlewareStack {
    return new MiddlewareStack(factories.map((factory) => factory()))
  }

  async beforeRun(ctx: RunStackContext): Promise<void> {
    for (const middleware of this.middleware) {
      await middleware.beforeRun?.(this.runScope(ctx, middleware))
    }
  }

  async afterRun(ctx: RunStackContext, summary: RunSummary): Promise<void> {
    for (let index = this.middleware.length - 1; index >= 0; index -= 1) {
      await this.middleware[index].afterRun?.(this.runScope(ctx, this.middleware[index]), summary)
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

  // Binds `activity` to this middleware's name, derived per dispatch. The
  // step and run variants differ only in the emitter the engine handed over:
  // the step one attaches a messageID, the run one does not.
  private scope(ctx: StackContext, middleware: Middleware): HookContext {
    return { ...ctx, activity: this.bind(ctx.openActivity, middleware) }
  }

  private runScope(ctx: RunStackContext, middleware: Middleware): RunContext {
    return { ...ctx, activity: this.bind(ctx.openActivity, middleware) }
  }

  private bind(open: ActivityEmitter, middleware: Middleware) {
    return (input: { label: string; detail?: string }) => open({ ...input, source: middleware.name })
  }
}

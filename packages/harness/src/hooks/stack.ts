// MiddlewareStack: ordered dispatch over a loop-scoped set of middleware.
// Dispatch semantics per hook: contributeSystem concat; transformMessages /
// afterToolCall / resolveOutcome fold-left; beforeTurn first stop short-circuits;
// beforeToolCall first deny short-circuits (args thread through); onTurnFinish
// first fail wins; onToolError first stop wins.
import type { ModelMessage } from "@harness/llm/types"
import type {
  FinishDecision,
  HookContext,
  Middleware,
  MiddlewareFactory,
  ToolCall,
  ToolErrorDecision,
  ToolGate,
  TurnFinishInfo,
  TurnGate,
  TurnOutcome,
} from "@harness/hooks/types"
import type { ErrorInfo, ToolExecuteResult } from "@harness/types"

export class MiddlewareStack {
  private constructor(private readonly middleware: Middleware[]) {}

  static build(factories: MiddlewareFactory[]): MiddlewareStack {
    return new MiddlewareStack(factories.map((factory) => factory()))
  }

  async contributeSystem(ctx: HookContext): Promise<string[]> {
    const fragments: string[] = []
    for (const middleware of this.middleware) {
      if (!middleware.contributeSystem) continue
      fragments.push(...(await middleware.contributeSystem(ctx)))
    }
    return fragments
  }

  async transformMessages(ctx: HookContext, messages: ModelMessage[]): Promise<ModelMessage[]> {
    let current = messages
    for (const middleware of this.middleware) {
      if (!middleware.transformMessages) continue
      current = await middleware.transformMessages(ctx, current)
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

  async onTurnFinish(ctx: HookContext, finish: TurnFinishInfo): Promise<FinishDecision> {
    let structured: unknown
    for (const middleware of this.middleware) {
      if (!middleware.onTurnFinish) continue
      const decision = await middleware.onTurnFinish(ctx, finish)
      if (!decision.ok) return decision
      if (decision.structured !== undefined) structured = decision.structured
    }
    return { ok: true, structured }
  }

  async resolveOutcome(ctx: HookContext, outcome: TurnOutcome): Promise<TurnOutcome> {
    let current = outcome
    for (const middleware of this.middleware) {
      if (!middleware.resolveOutcome) continue
      current = await middleware.resolveOutcome(ctx, current)
    }
    return current
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

  async afterToolCall(ctx: HookContext, call: ToolCall, result: ToolExecuteResult): Promise<ToolExecuteResult> {
    let current = result
    for (const middleware of this.middleware) {
      if (!middleware.afterToolCall) continue
      current = await middleware.afterToolCall(ctx, call, current)
    }
    return current
  }

  async onToolError(ctx: HookContext, call: ToolCall, error: ErrorInfo): Promise<ToolErrorDecision> {
    for (const middleware of this.middleware) {
      if (!middleware.onToolError) continue
      const decision = await middleware.onToolError(ctx, call, error)
      if (decision.action === "stop") return decision
    }
    return { action: "continue" }
  }
}

/**
 * Engine-internal contexts: the immutable input bundles for a run and for one
 * turn inside it. Middleware see the RunContext / HookContext views; the engine
 * additionally knows the user message and the resolved tools. All turn-scoped
 * *accumulation* (phase, open parts, counters, terminal state) lives in the
 * TurnRecorder — context carries no mutable state, so nothing can hold a stale
 * shadow of the store.
 */
import type { CoreConfig } from "@agent-core/config"
import type { RuntimeEventBus } from "@agent-core/event/bus"
import type { Model } from "@agent-core/llm/types"
import type { TurnExecutionPolicy } from "@agent-core/policy"
import type { AgentDefinition } from "@agent-core/blueprint"
import type { ActivityEmitter, RunContext, StackContext } from "@agent-core/hooks"
import type { Sessions } from "@agent-core/session"
import type { ToolDefinition, UserMessage } from "@agent-core/types"

/**
 * The engine's dependency surface: the three collaborators a loop cannot be
 * written without. Everything an agent's tools happen to need — a file tree, a
 * skill catalogue, other agents — reaches them through the closures they were
 * built with, not through here.
 */
export type EngineDeps = {
  config: CoreConfig
  sessions: Sessions
  events: RuntimeEventBus
}

/** The engine-internal turn context: StackContext plus the turn's resolved inputs. */
export type TurnContext = StackContext & {
  readonly user: UserMessage
  readonly tools: ToolDefinition[]
  readonly events: RuntimeEventBus
}

/**
 * Assembles the run context: what holds still for the whole loop.
 *
 * @param input - engine deps plus the run's agent, model, session id, and abort
 * @returns the immutable run context
 */
export function createRunContext(input: {
  deps: EngineDeps
  agent: AgentDefinition
  model: Model
  sessionID: string
  abort: AbortSignal
}): RunContext {
  return {
    config: input.deps.config,
    sessions: input.deps.sessions,
    agent: input.agent,
    sessionID: input.sessionID,
    abort: input.abort,
    model: input.model,
  }
}

/**
 * Assembles the per-turn TurnContext from the run context and turn inputs.
 *
 * @param input - the run context and engine deps, plus this turn's policy, user
 *   message, assistant message id, tools, step number, abort, and emitter
 * @returns the immutable turn context
 */
export function createTurnContext(input: {
  run: RunContext
  deps: EngineDeps
  policy: TurnExecutionPolicy
  user: UserMessage
  messageID: string
  tools: ToolDefinition[]
  step: number
  abort: AbortSignal
  openActivity: ActivityEmitter
}): TurnContext {
  return {
    ...input.run,
    events: input.deps.events,
    messageID: input.messageID,
    step: input.step,
    policy: input.policy,
    abort: input.abort,
    format: input.user.format,
    openActivity: input.openActivity,
    user: input.user,
    tools: input.tools,
  }
}

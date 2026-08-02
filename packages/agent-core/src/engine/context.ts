/**
 * Engine-internal contexts: the immutable input bundles for a run and for one
 * step inside it. Middleware see the RunContext / HookContext views; the engine
 * additionally knows the user message and the resolved tools. All step-scoped
 * *accumulation* (phase, open parts, counters, terminal state) lives in the
 * StepRecorder — context carries no mutable state, so nothing can hold a stale
 * shadow of the store.
 */
import type { AgentDefinition } from "@agent-core/agent"
import type { EngineDeps } from "@agent-core/context"
import type { RuntimeEventBus } from "@agent-core/events"
import type { Model } from "@agent-core/llm/types"
import type { StepExecutionPolicy } from "@agent-core/policy"
import type { ActivityEmitter, RunStackContext, StackContext } from "@agent-core/hooks"
import type { UserMessage } from "@agent-core/model"
import type { ToolDefinition } from "@agent-core/tool/tool"

/** The engine-internal step context: StackContext plus the step's resolved inputs. */
export type StepContext = StackContext & {
  readonly user: UserMessage
  readonly tools: ToolDefinition[]
  readonly events: RuntimeEventBus
}

/**
 * Assembles the run context: what holds still for the whole loop. Activity
 * arrives unbound (the stack names the source per middleware), carried by the
 * run-boundary emitter — its events have no messageID.
 *
 * @param input - engine deps plus the run's agent, model, session id, abort, and emitter
 * @returns the immutable run context
 */
export function createRunContext(input: {
  deps: EngineDeps
  agent: AgentDefinition
  model: Model
  sessionID: string
  abort: AbortSignal
  openActivity: ActivityEmitter
}): RunStackContext {
  return {
    config: input.deps.config,
    sessions: input.deps.sessions,
    agent: input.agent,
    sessionID: input.sessionID,
    abort: input.abort,
    model: input.model,
    openActivity: input.openActivity,
  }
}

/**
 * Assembles the per-step StepContext from the run context and step inputs.
 *
 * @param input - the run context and engine deps, plus this step's policy, user
 *   message, assistant message id, tools, step number, abort, and emitter
 * @returns the immutable step context
 */
export function createStepContext(input: {
  run: RunStackContext
  deps: EngineDeps
  policy: StepExecutionPolicy
  user: UserMessage
  messageID: string
  tools: ToolDefinition[]
  step: number
  abort: AbortSignal
  openActivity: ActivityEmitter
}): StepContext {
  return {
    ...input.run,
    events: input.deps.events,
    messageID: input.messageID,
    step: input.step,
    policy: input.policy,
    abort: input.abort,
    format: input.user.format,
    // Shadows the run-boundary emitter: inside a step, activities carry the
    // step's messageID and render under it.
    openActivity: input.openActivity,
    user: input.user,
    tools: input.tools,
  }
}

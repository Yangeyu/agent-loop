/**
 * Engine-internal per-turn context: the immutable input bundle for one turn.
 * Middleware see the HookContext view; the engine additionally knows the user
 * message and the resolved tools. All turn-scoped *accumulation* (phase, open
 * parts, counters, terminal state) lives in the TurnRecorder — context carries
 * no mutable state, so nothing can hold a stale shadow of the store.
 */
import type { Model } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/core/policy"
import type { HookContext } from "@harness/hooks/types"
import type { RuntimeDeps } from "@harness/runtime/context"
import type { ToolDefinition, UserMessage } from "@harness/types"

/** The engine's dependency surface is exactly the runtime's dependency surface. */
export type EngineDeps = RuntimeDeps

/** The engine-internal turn context: HookContext plus the turn's resolved inputs. */
export type TurnContext = HookContext & {
  readonly user: UserMessage
  readonly tools: ToolDefinition[]
}

/**
 * Assembles the per-turn TurnContext from the engine deps and turn inputs.
 *
 * @param input - engine deps plus this turn's agent, model, policy, ids,
 *   user message, assistant message id, tools, step number, and abort signal
 * @returns the immutable turn context
 */
export function createTurnContext(input: {
  deps: EngineDeps
  agent: HookContext["agent"]
  model: Model
  policy: TurnExecutionPolicy
  sessionID: string
  rootID: string
  user: UserMessage
  messageID: string
  tools: ToolDefinition[]
  step: number
  abort: AbortSignal
}): TurnContext {
  return {
    config: input.deps.config,
    sessions: input.deps.sessions,
    events: input.deps.events,
    agent_registry: input.deps.agent_registry,
    skill_registry: input.deps.skill_registry,
    tool_registry: input.deps.tool_registry,
    agent: input.agent,
    sessionID: input.sessionID,
    rootID: input.rootID,
    messageID: input.messageID,
    step: input.step,
    policy: input.policy,
    abort: input.abort,
    format: input.user.format,
    model: input.model,
    user: input.user,
    tools: input.tools,
  }
}

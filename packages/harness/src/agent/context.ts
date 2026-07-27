/**
 * Engine-internal contexts: the immutable input bundles for a run and for one
 * turn inside it. Middleware see the RunContext / HookContext views; the engine
 * additionally knows the user message and the resolved tools. All turn-scoped
 * *accumulation* (phase, open parts, counters, terminal state) lives in the
 * TurnRecorder — context carries no mutable state, so nothing can hold a stale
 * shadow of the store.
 */
import type { AgentRegistry } from "@harness/agent/registry"
import type { Config } from "@harness/config"
import type { RuntimeEventBus } from "@harness/event/bus"
import type { Model } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/agent/policy"
import type { AgentDefinition } from "@harness/agent/blueprint"
import type { ActivityEmitter, RunContext, StackContext } from "@harness/agent/hooks"
import type { Sessions } from "@harness/session"
import type { SkillRegistry } from "@harness/skill/registry"
import type { ToolRegistry } from "@harness/tool/registry"
import type { ToolDefinition, UserMessage } from "@harness/types"
import type { Workspace } from "@harness/workspace"

/** The engine's dependency surface — the kernel owns this contract; the runtime
 * layer's RuntimeContext is exactly one of these plus nothing else. */
export type EngineDeps = {
  config: Config
  sessions: Sessions
  events: RuntimeEventBus
  agent_registry: AgentRegistry
  skill_registry: SkillRegistry
  tool_registry: ToolRegistry
  // The local file tree as an owned collaborator. Tools go through it instead of
  // `node:fs` + `process.cwd()`, which is what makes concurrent file work safe
  // without the engine knowing anything about what a tool does.
  workspace: Workspace
}

/** The engine-internal turn context: StackContext plus the turn's resolved
 * inputs. The full registries live here (not on the hook views): tool resolution
 * and agent lookup are engine/tool-context concerns, and middleware never
 * performs them. */
export type TurnContext = StackContext & {
  readonly user: UserMessage
  readonly tools: ToolDefinition[]
  readonly agent_registry: AgentRegistry
  readonly skill_registry: SkillRegistry
  readonly tool_registry: ToolRegistry
  readonly workspace: Workspace
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
    events: input.deps.events,
    agent_registry: input.deps.agent_registry,
    skill_registry: input.deps.skill_registry,
    agent: input.agent,
    sessionID: input.sessionID,
    abort: input.abort,
    model: input.model,
  }
}

/**
 * Assembles the per-turn TurnContext from the run context and turn inputs.
 *
 * @param input - the run context and engine deps, plus this turn's policy, ids,
 *   user message, assistant message id, tools, step number, and abort signal
 * @returns the immutable turn context
 */
export function createTurnContext(input: {
  run: RunContext
  deps: EngineDeps
  policy: TurnExecutionPolicy
  rootID: string
  user: UserMessage
  messageID: string
  tools: ToolDefinition[]
  step: number
  abort: AbortSignal
  openActivity: ActivityEmitter
}): TurnContext {
  return {
    ...input.run,
    // The narrow list-only views on RunContext widen back to the real
    // registries here: tool resolution and agent lookup are engine concerns.
    agent_registry: input.deps.agent_registry,
    skill_registry: input.deps.skill_registry,
    tool_registry: input.deps.tool_registry,
    workspace: input.deps.workspace,
    rootID: input.rootID,
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

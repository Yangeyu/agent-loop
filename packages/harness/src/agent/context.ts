/**
 * Engine-internal per-turn context: the immutable input bundle for one turn.
 * Middleware see the HookContext view; the engine additionally knows the user
 * message and the resolved tools. All turn-scoped *accumulation* (phase, open
 * parts, counters, terminal state) lives in the TurnRecorder — context carries
 * no mutable state, so nothing can hold a stale shadow of the store.
 */
import type { AgentRegistry } from "@harness/agent/registry"
import type { Config } from "@harness/config"
import type { RuntimeEventBus } from "@harness/event/bus"
import type { Model } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/agent/policy"
import type { HookContext } from "@harness/agent/hooks"
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

/** The engine-internal turn context: HookContext plus the turn's resolved inputs.
 * The full registries live here (not on HookContext): tool resolution and agent
 * lookup are engine/tool-context concerns, and middleware never performs them. */
export type TurnContext = HookContext & {
  readonly user: UserMessage
  readonly tools: ToolDefinition[]
  readonly agent_registry: AgentRegistry
  readonly skill_registry: SkillRegistry
  readonly tool_registry: ToolRegistry
  readonly workspace: Workspace
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
    workspace: input.deps.workspace,
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

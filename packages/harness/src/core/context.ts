// Engine-internal per-turn context. Superset of HookContext: middleware see the
// HookContext view; the engine additionally tracks streaming accumulation state.
import type { ModelCaller, ModelProvider } from "@harness/agent/model"
import type { ModelMessage } from "@harness/llm/types"
import type { TurnExecutionPolicy } from "@harness/core/policy"
import type { HookContext } from "@harness/hooks/types"
import type { RuntimeDeps } from "@harness/runtime/context"
import type {
  AssistantMessage,
  ReasoningPart,
  TextPart,
  ToolDefinition,
  TurnPhase,
  UserMessage,
} from "@harness/types"

// The engine's dependency surface is exactly the runtime's dependency surface.
export type EngineDeps = RuntimeDeps

export type TurnContext = HookContext & {
  user: UserMessage
  assistant: AssistantMessage
  modelCaller: ModelCaller
  // Engine-only: passed through so tools (e.g. task delegation) can spawn a
  // nested runSession. Not part of the middleware-facing HookContext.
  model_provider: ModelProvider
  tools: ToolDefinition[]
  system: string[]
  messages: ModelMessage[]
  phase: TurnPhase
  startedAt: number
  retryCount: number
  toolCalls: number
  sawReasoning: boolean
  sawText: boolean
  reasoningPart?: ReasoningPart
  textPart?: TextPart
}

export function createTurnContext(input: {
  deps: EngineDeps
  agent: HookContext["agent"]
  modelCaller: ModelCaller
  policy: TurnExecutionPolicy
  sessionID: string
  user: UserMessage
  assistant: AssistantMessage
  tools: ToolDefinition[]
  step: number
  abort: AbortSignal
}): TurnContext {
  return {
    config: input.deps.config,
    session_store: input.deps.session_store,
    events: input.deps.events,
    agent_registry: input.deps.agent_registry,
    skill_registry: input.deps.skill_registry,
    tool_registry: input.deps.tool_registry,
    agent: input.agent,
    sessionID: input.sessionID,
    messageID: input.assistant.parentID,
    turnID: input.assistant.id,
    step: input.step,
    policy: input.policy,
    abort: input.abort,
    format: input.user.format,
    llm: input.modelCaller,
    user: input.user,
    assistant: input.assistant,
    modelCaller: input.modelCaller,
    model_provider: input.deps.model_provider,
    tools: input.tools,
    system: [],
    messages: [],
    phase: "starting",
    startedAt: Date.now(),
    retryCount: 0,
    toolCalls: 0,
    sawReasoning: false,
    sawText: false,
  }
}

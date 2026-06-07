// The agent orchestration loop. Agent-agnostic: it resolves the agent blueprint
// once per run, builds the loop-scoped middleware stack (the AgentRun), then
// drives turns until a middleware-shaped outcome breaks. Delegation to a
// subagent is just another runSession on a child session (see tool/task.ts).
import { createModelCaller } from "@harness/agent/model"
import type { AgentDefinition } from "@harness/agent/types"
import { createTurnContext, type EngineDeps } from "@harness/core/context"
import { baseOutcome } from "@harness/core/outcome"
import { createTurnAbortSignal, resolveTurnExecutionPolicy } from "@harness/core/policy"
import { appendStopNote } from "@harness/core/stream-sink"
import { runTurn } from "@harness/core/turn"
import { MiddlewareStack } from "@harness/hooks/stack"
import { toModelMessages } from "@harness/session/model-message"
import {
  createID,
  type AssistantMessage,
  type OutputFormat,
  type ProviderModel,
  type SessionInfo,
  type UserMessage,
} from "@harness/types"

export type RunSessionInput = {
  sessionID: string
  text: string
  agent?: string
  model?: ProviderModel
  format?: OutputFormat
  abort?: AbortSignal
}

export async function runSession(deps: EngineDeps, input: RunSessionInput): Promise<SessionInfo> {
  const store = deps.session_store
  const agent = deps.agent_registry.get(input.agent ?? deps.agent_registry.defaultAgent().name)
  const user = createUserMessage({
    sessionID: input.sessionID,
    agent,
    model: input.model,
    format: input.format ?? agent.format,
  })

  store.appendUserMessage(input.sessionID, user)
  store.appendTextPart(input.sessionID, user.id, { id: createID(), type: "text", text: input.text })
  deps.events.emit({
    type: "session-start",
    sessionID: input.sessionID,
    agent: user.agent,
    text: store.getMessageText(input.sessionID, user.id),
  })

  return runLoop(deps, { sessionID: input.sessionID, agent, abort: input.abort })
}

export async function runLoop(
  deps: EngineDeps,
  input: { sessionID: string; agent: AgentDefinition; abort?: AbortSignal },
): Promise<SessionInfo> {
  const store = deps.session_store
  const modelCaller = createModelCaller(input.agent.model, deps.model_provider)
  const stack = MiddlewareStack.build(input.agent.assemble().middleware)
  const rootAbort = input.abort ?? new AbortController().signal

  let step = 0
  while (true) {
    step += 1
    const session = store.get(input.sessionID)
    const user = resolveLastUserMessage(session)
    const policy = resolveTurnExecutionPolicy(deps.config, input.agent, session)

    deps.events.emit({ type: "loop-step", sessionID: input.sessionID, step, agent: input.agent.name })

    const tools = [...(await deps.tool_registry.toolsForAgent(input.agent))]
    const assistant = createAssistantMessage(input.sessionID, user, input.agent)
    store.appendAssistantMessage(input.sessionID, assistant)

    const turnAbort = createTurnAbortSignal({ parent: rootAbort, timeoutMs: policy.timeout.turnTimeoutMs })
    const ctx = createTurnContext({
      deps,
      agent: input.agent,
      modelCaller,
      policy,
      sessionID: input.sessionID,
      user,
      assistant,
      tools,
      step,
      abort: turnAbort.signal,
    })

    try {
      const gate = await stack.beforeTurn(ctx)
      if (!gate.proceed) {
        store.updateMessage(input.sessionID, assistant.id, { finish: "stop" })
        if (gate.note) appendStopNote(ctx, gate.note)
        emitTurnOutcome(ctx, { kind: "break", reason: gate.reason })
        return store.get(input.sessionID)
      }

      ctx.system = await stack.contributeSystem(ctx)
      ctx.messages = await stack.transformMessages(ctx, toModelMessages(store.get(input.sessionID)))

      deps.events.emit({
        type: "turn-input",
        sessionID: input.sessionID,
        agent: input.agent.name,
        messageID: assistant.parentID,
        turnID: assistant.id,
        step,
        system: ctx.system,
        tools: tools.map((tool) => tool.id),
        messageCount: store.get(input.sessionID).messages.length,
      })

      const { sawToolCall } = await runTurn(ctx, stack)
      const outcome = await stack.resolveOutcome(ctx, baseOutcome(ctx, sawToolCall))

      if (outcome.kind === "break" && outcome.note) appendStopNote(ctx, outcome.note)
      emitTurnOutcome(ctx, outcome)

      if (outcome.kind === "break") return store.get(input.sessionID)
    } finally {
      turnAbort.dispose()
    }
  }
}

function emitTurnOutcome(
  ctx: ReturnType<typeof createTurnContext>,
  outcome: { kind: "continue" | "break"; reason: string },
) {
  ctx.events.emit({
    type: "turn-outcome",
    sessionID: ctx.sessionID,
    agent: ctx.agent.name,
    messageID: ctx.assistant.parentID,
    turnID: ctx.assistant.id,
    step: ctx.step,
    outcome: outcome.kind,
    reason: outcome.reason as never,
  })
}

function resolveLastUserMessage(session: SessionInfo): UserMessage {
  const user = [...session.messages].reverse().find((message) => message.role === "user")
  if (!user) throw new Error("No user message found")
  return user as UserMessage
}

function createUserMessage(input: {
  sessionID: string
  agent: AgentDefinition
  model?: ProviderModel
  format?: OutputFormat
}): UserMessage {
  return {
    id: createID(),
    role: "user",
    sessionID: input.sessionID,
    agent: input.agent.name,
    model: input.model ?? { providerID: input.agent.model.providerID, modelID: input.agent.model.modelID },
    format: input.format,
    time: { created: Date.now() },
  }
}

function createAssistantMessage(sessionID: string, user: UserMessage, agent: AgentDefinition): AssistantMessage {
  return {
    id: createID(),
    role: "assistant",
    sessionID,
    parentID: user.id,
    agent: agent.name,
    model: user.model,
    time: { created: Date.now() },
  }
}

import type { RuntimeDeps } from "@harness/runtime/context"
import { createTurnAbortSignal, resolveTurnExecutionPolicy } from "@harness/session/execution-policy"
import { withDelegationDescription } from "@harness/tool/task"
import { withSkillDescription } from "@harness/tool/skill"
import { toModelMessages } from "@harness/session/model-message"
import { SessionProcessor } from "@harness/session/processor"
import { buildSystemPrompt } from "@harness/session/system"
import {
  applyTurnOutcome,
  resolveTurnOutcome,
  type PromptLoopContext,
  type PromptTurnState,
} from "@harness/session/turn-lifecycle"
import { createID, type AgentInfo, type AssistantMessage, type ProviderModel, type UserMessage } from "@harness/types"

type PromptInput = {
  sessionID: string
  text: string
  agent?: string
  model?: ProviderModel
  format?: UserMessage["format"]
  abort?: AbortSignal
}

export namespace SessionPrompt {
  export async function prompt(input: PromptInput, deps: RuntimeDeps) {
    const store = deps.session_store
    const session = store.get(input.sessionID)
    const agent = deps.agent_registry.get(input.agent ?? "build")
    const user = createUserMessage({
      sessionID: session.id,
      agent,
      model: input.model,
      format: input.format ?? agent.format,
    })

    store.appendUserMessage(session.id, user)
    store.appendTextPart(session.id, user.id, {
      id: createID(),
      type: "text",
      text: input.text,
    })
    emitSessionStart(deps, session.id, user)

    return loop({ sessionID: session.id, abort: input.abort }, deps)
  }

  export async function loop(input: { sessionID: string; abort?: AbortSignal }, deps: RuntimeDeps) {
    const context: PromptLoopContext = {
      config: deps.config,
      agent_registry: deps.agent_registry,
      skill_registry: deps.skill_registry,
      session_store: deps.session_store,
      sessionID: input.sessionID,
      abort: input.abort ?? new AbortController().signal,
      step: 0,
      tool_registry: deps.tool_registry,
      events: deps.events,
    }

    while (true) {
      context.step += 1

      const state = await prepareLoopState(context)
      if (state.policy.budget.maxSteps <= 0) {
        stopForExhaustedSessionBudget(context, state)
        return context.session_store.get(context.sessionID)
      }

      const result = await runLoopStep(context, state)
      const outcome = resolveTurnOutcome({ context, state, result })
      const decision = applyTurnOutcome({ context, state, outcome })

      if (decision.kind === "break") {
        return context.session_store.get(context.sessionID)
      }
    }
  }
}

function createUserMessage(input: {
  sessionID: string
  agent: AgentInfo
  model?: ProviderModel
  format?: UserMessage["format"]
}): UserMessage {
  return {
    id: createID(),
    role: "user",
    sessionID: input.sessionID,
    agent: input.agent.name,
    model: input.model ?? { providerID: "qwen", modelID: "qwen3.5-plus" },
    format: input.format,
    time: {
      created: Date.now(),
    },
  }
}

function emitSessionStart(deps: RuntimeDeps, sessionID: string, user: UserMessage) {
  deps.events.emit({
    type: "session-start",
    sessionID,
    agent: user.agent,
    text: deps.session_store.getMessageText(sessionID, user.id),
  })
}

async function prepareLoopState(context: PromptLoopContext): Promise<PromptTurnState> {
  const session = context.session_store.get(context.sessionID)
  const user = resolveLastUserMessage(context.session_store, session.id)
  const agent = context.agent_registry.get(user.agent)
  const policy = resolveTurnExecutionPolicy(context.config, agent, session)

  context.events.emit({
    type: "loop-step",
    sessionID: session.id,
    step: context.step,
    agent: agent.name,
  })

  const tools = await resolveToolsForTurn(
    context.tool_registry,
    context.agent_registry,
    context.skill_registry,
    agent,
  )
  const assistant = createAssistantMessage(session.id, user, agent)
  context.session_store.appendAssistantMessage(session.id, assistant)

  return {
    user,
    agent,
    policy,
    tools,
    assistant,
  }
}

async function runLoopStep(context: PromptLoopContext, state: PromptTurnState) {
  const session = context.session_store.get(context.sessionID)
  const system = buildSystemPrompt({
    agent: state.agent,
    format: state.user.format,
    skills: context.skill_registry.list(),
    step: context.step,
    maxSteps: state.policy.budget.maxSteps,
  })

  context.events.emit({
    type: "turn-input",
    sessionID: session.id,
    agent: state.agent.name,
    messageID: state.assistant.parentID,
    turnID: state.assistant.id,
    step: context.step,
    system,
    tools: state.tools.map((tool) => tool.id),
    messageCount: session.messages.length,
  })

  const turnAbort = createTurnAbortSignal({
    parent: context.abort,
    timeoutMs: state.policy.timeout.turnTimeoutMs,
  })

  try {
    return await SessionProcessor.process({
      config: context.config,
      session_store: context.session_store,
      events: context.events,
      agent_registry: context.agent_registry,
      skill_registry: context.skill_registry,
      session,
      user: state.user,
      assistant: state.assistant,
      agent: state.agent,
      system,
      messages: toModelMessages(session),
      tools: state.tools,
      tool_registry: context.tool_registry,
      policy: state.policy,
      abort: turnAbort.signal,
    })
  } finally {
    turnAbort.dispose()
  }
}

function resolveLastUserMessage(store: RuntimeDeps["session_store"], sessionID: string) {
  const session = store.get(sessionID)
  const user = [...session.messages].reverse().find((message) => message.role === "user")
  if (!user) throw new Error("No user message found")
  return user as UserMessage
}

function createAssistantMessage(sessionID: string, user: UserMessage, agent: AgentInfo): AssistantMessage {
  return {
    id: createID(),
    role: "assistant",
    sessionID,
    parentID: user.id,
    agent: agent.name,
    model: user.model,
    time: {
      created: Date.now(),
    },
  }
}

function stopForExhaustedSessionBudget(context: PromptLoopContext, state: PromptTurnState) {
  context.events.emit({
    type: "budget-hit",
    sessionID: context.sessionID,
    agent: state.agent.name,
    budget: "session_steps",
    detail: "Total session step budget reached",
    limit: state.policy.budget.maxSessionSteps,
    used: state.policy.budget.sessionStepsUsed,
  })

  context.session_store.updateMessage(context.sessionID, state.assistant.id, { finish: "stop" })
  context.session_store.appendTextPart(context.sessionID, state.assistant.id, {
    id: createID(),
    type: "text",
    text: "\n\n[Stopped: total session step budget reached]",
    synthetic: true,
  })
}

async function resolveToolsForTurn(
  toolRegistry: RuntimeDeps["tool_registry"],
  agentRegistry: RuntimeDeps["agent_registry"],
  skillRegistry: RuntimeDeps["skill_registry"],
  agent: AgentInfo,
) {
  const tools = [...(await toolRegistry.toolsForAgent(agent))].map((tool) => {
    if (tool.id === "skill") {
      return withSkillDescription({
        tool,
        skills: skillRegistry.list(),
      })
    }

    if (tool.id !== "task" && tool.id !== "task_resume") {
      return tool
    }

    return withDelegationDescription({
      tool,
      agentRegistry,
    })
  })

  return tools
}

import type { AgentRegistry } from "@harness/agent/registry"
import type { ModelMessage, LLMInput } from "@harness/llm/types"
import type { RuntimeTrace, TurnTrace } from "@harness/runtime/trace"
import { toModelMessages } from "@harness/session/model-message"
import type { ISessionStore } from "@harness/session/store/types"
import type { ToolRegistry } from "@harness/tool/registry"
import type { AssistantMessage, SessionInfo, ToolDefinition, UserMessage } from "@harness/types"

export type ReplayTurnInput = {
  sessionID: string
  messageID: string
  turnID: string
  step: number
  agent: string
  system: string[]
  tools: string[]
  messages: ModelMessage[]
  llmInput: LLMInput
}

export type RuntimeReplay = {
  turnInput(input: { sessionID: string; turnID: string } | { sessionID: string; step: number }): ReplayTurnInput
}

export function createRuntimeReplay(input: {
  session_store: ISessionStore
  agent_registry: AgentRegistry
  tool_registry: ToolRegistry
  trace: RuntimeTrace
}): RuntimeReplay {
  return {
    turnInput(selector) {
      const turn = resolveTurn(input.trace, selector)
      const session = input.session_store.get(turn.sessionID)
      const assistant = resolveAssistantMessage(session, turn.turnID)
      const user = resolveUserMessage(session, assistant.parentID)
      const agent = input.agent_registry.get(assistant.agent)
      const replaySession = buildReplaySession(session, assistant.id)
      const tools = resolveTools(input.tool_registry, turn.tools ?? [])
      const messages = toModelMessages(replaySession)

      return {
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        turnID: turn.turnID,
        step: turn.step,
        agent: turn.agent,
        system: [...(turn.system ?? [])],
        tools: tools.map((tool) => tool.id),
        messages,
        llmInput: {
          session: replaySession,
          user,
          assistant,
          agent,
          system: [...(turn.system ?? [])],
          messages,
          tools,
          abort: new AbortController().signal,
        },
      }
    },
  }
}

function resolveTurn(trace: RuntimeTrace, selector: { sessionID: string; turnID: string } | { sessionID: string; step: number }) {
  const turns = trace.turnsForSession(selector.sessionID)

  if ("turnID" in selector) {
    const turn = turns.find((item) => item.turnID === selector.turnID)
    if (!turn) throw new Error(`Replay turn not found for session ${selector.sessionID} turn ${selector.turnID}`)
    return turn
  }

  const turn = turns.find((item) => item.step === selector.step)
  if (!turn) throw new Error(`Replay turn not found for session ${selector.sessionID} step ${selector.step}`)
  return turn
}

function resolveAssistantMessage(session: SessionInfo, turnID: string) {
  const message = session.messages.find((item) => item.id === turnID)
  if (!message || message.role !== "assistant") {
    throw new Error(`Replay assistant message not found: ${turnID}`)
  }

  return message as AssistantMessage
}

function resolveUserMessage(session: SessionInfo, messageID: string) {
  const message = session.messages.find((item) => item.id === messageID)
  if (!message || message.role !== "user") {
    throw new Error(`Replay user message not found: ${messageID}`)
  }

  return message as UserMessage
}

function resolveTools(toolRegistry: ToolRegistry, toolIDs: string[]): ToolDefinition[] {
  return toolIDs.map((toolID) => toolRegistry.get(toolID))
}

function buildReplaySession(session: SessionInfo, assistantMessageID: string): SessionInfo {
  const messages = session.messages
    .slice(0, session.messages.findIndex((message) => message.id === assistantMessageID) + 1)
    .map((message) => {
      if (message.id !== assistantMessageID || message.role !== "assistant") return message

      return {
        ...message,
        finish: undefined,
        error: undefined,
        structured: undefined,
      }
    })

  const parts = Object.fromEntries(
    messages.map((message) => {
      if (message.id === assistantMessageID) return [message.id, []]
      return [message.id, [...(session.parts[message.id] ?? [])]]
    }),
  )

  return {
    id: session.id,
    parentID: session.parentID,
    title: session.title,
    messages,
    parts,
  }
}

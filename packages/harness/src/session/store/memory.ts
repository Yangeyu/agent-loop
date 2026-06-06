import { createID, type AssistantMessage, type MessagePart, type ReasoningPart, type SessionInfo, type SessionMessage, type TextPart, type ToolPart, type UserMessage } from "@harness/types"
import type { ISessionStore } from "./types"

export class MemorySessionStore implements ISessionStore {
  private sessions = new Map<string, SessionInfo>()

  create(input: { parentID?: string; title: string }) {
    const session: SessionInfo = {
      id: createID(),
      parentID: input.parentID,
      title: input.title,
      messages: [],
      parts: {},
    }
    this.sessions.set(session.id, session)
    return session
  }

  get(sessionID: string) {
    const session = this.sessions.get(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    return session
  }

  list() {
    return [...this.sessions.values()]
  }

  addMessage(sessionID: string, message: SessionMessage) {
    const session = this.get(sessionID)
    session.messages.push(message)
    return message
  }

  appendUserMessage(sessionID: string, message: UserMessage) {
    return this.addMessage(sessionID, message)
  }

  appendAssistantMessage(sessionID: string, message: AssistantMessage) {
    return this.addMessage(sessionID, message)
  }

  updateMessage(sessionID: string, messageID: string, patch: Partial<AssistantMessage>) {
    const session = this.get(sessionID)
    const index = session.messages.findIndex((message) => message.id === messageID)
    if (index === -1) throw new Error(`Message not found: ${messageID}`)
    session.messages[index] = {
      ...(session.messages[index] as AssistantMessage),
      ...patch,
    }
    return session.messages[index] as AssistantMessage
  }

  addPart(sessionID: string, messageID: string, part: MessagePart) {
    const session = this.get(sessionID)
    session.parts[messageID] ||= []
    session.parts[messageID].push(part)
    return part
  }

  appendReasoningPart(sessionID: string, messageID: string, part: ReasoningPart) {
    return this.addPart(sessionID, messageID, part) as ReasoningPart
  }

  appendTextPart(sessionID: string, messageID: string, part: TextPart) {
    return this.addPart(sessionID, messageID, part) as TextPart
  }

  startToolPart(sessionID: string, messageID: string, part: ToolPart) {
    return this.addPart(sessionID, messageID, part) as ToolPart
  }

  updatePart(sessionID: string, messageID: string, partID: string, patch: Partial<MessagePart>) {
    const session = this.get(sessionID)
    const parts = session.parts[messageID] || []
    const index = parts.findIndex((part) => part.id === partID)
    if (index === -1) throw new Error(`Part not found: ${partID}`)
    parts[index] = {
      ...(parts[index] as Record<string, unknown>),
      ...(patch as Record<string, unknown>),
    } as MessagePart
    return parts[index]
  }

  getParts(sessionID: string, messageID: string) {
    return this.get(sessionID).parts[messageID] || []
  }

  getTextParts(sessionID: string, messageID: string) {
    return this.getParts(sessionID, messageID).filter((part): part is TextPart => part.type === "text")
  }

  getMessageText(sessionID: string, messageID: string, options?: { includeSynthetic?: boolean }) {
    return this.getTextParts(sessionID, messageID)
      .filter((part) => options?.includeSynthetic !== false || part.synthetic !== true)
      .map((part) => part.text)
      .join("")
  }

  replaceState(input: { sessionID: string; messages: SessionMessage[]; parts: Record<string, MessagePart[]> }) {
    const session = this.get(input.sessionID)
    session.messages = input.messages
    session.parts = input.parts
    return session
  }
}

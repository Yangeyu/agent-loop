import {
  createID,
  type AssistantMessage,
  type MessagePart,
  type ReasoningPart,
  type SessionInfo,
  type SessionMessage,
  type TextPart,
  type ToolPart,
  type UserMessage,
} from "@harness/types"
import type { ISessionStore } from "./types"

// Shared CRUD over SessionInfo. Subclasses supply only where bytes live:
//   read(id)   — fetch a session, or null when absent
//   persist(s) — make the (possibly mutated) session durable
//   list()     — enumerate all sessions
// Every mutator is read → mutate-in-place → persist, so memory and file stores
// differ only in storage, never in how messages/parts are shaped.
export abstract class BaseSessionStore implements ISessionStore {
  protected abstract read(sessionID: string): SessionInfo | null
  protected abstract persist(session: SessionInfo): void
  abstract list(): SessionInfo[]

  create(input: { parentID?: string; title: string }) {
    const session: SessionInfo = {
      id: createID(),
      parentID: input.parentID,
      title: input.title,
      messages: [],
      parts: {},
    }
    this.persist(session)
    return session
  }

  get(sessionID: string) {
    const session = this.read(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    return session
  }

  addMessage(sessionID: string, message: SessionMessage) {
    const session = this.get(sessionID)
    session.messages.push(message)
    this.persist(session)
    return message
  }

  // Typed thin wrappers: same write as addMessage/addPart, narrowed return so
  // callers keep their concrete UserMessage/ReasoningPart/... type.
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
    this.persist(session)
    return session.messages[index] as AssistantMessage
  }

  addPart(sessionID: string, messageID: string, part: MessagePart) {
    const session = this.get(sessionID)
    session.parts[messageID] ||= []
    session.parts[messageID].push(part)
    this.persist(session)
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
    this.persist(session)
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
    this.persist(session)
    return session
  }
}

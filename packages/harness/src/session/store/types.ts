/** The session persistence contract: CRUD over sessions, messages, and parts. */
import type {
  AssistantMessage,
  MessagePart,
  ReasoningPart,
  SessionInfo,
  SessionMessage,
  TextPart,
  ToolPart,
  UserMessage,
} from "@harness/types"

/**
 * Storage-agnostic session store. Implementations (memory, file) persist the same
 * SessionInfo shape; the engine and middleware depend only on this interface.
 */
export interface ISessionStore {
  create(input: { parentID?: string; title: string }): SessionInfo
  get(sessionID: string): SessionInfo
  list(): SessionInfo[]
  addMessage(sessionID: string, message: SessionMessage): SessionMessage
  appendUserMessage(sessionID: string, message: UserMessage): SessionMessage
  appendAssistantMessage(sessionID: string, message: AssistantMessage): SessionMessage
  updateMessage(sessionID: string, messageID: string, patch: Partial<AssistantMessage>): AssistantMessage
  addPart(sessionID: string, messageID: string, part: MessagePart): MessagePart
  appendReasoningPart(sessionID: string, messageID: string, part: ReasoningPart): ReasoningPart
  appendTextPart(sessionID: string, messageID: string, part: TextPart): TextPart
  startToolPart(sessionID: string, messageID: string, part: ToolPart): ToolPart
  updatePart(sessionID: string, messageID: string, partID: string, patch: Partial<MessagePart>): MessagePart
  getParts(sessionID: string, messageID: string): MessagePart[]
  getTextParts(sessionID: string, messageID: string): TextPart[]
  getMessageText(sessionID: string, messageID: string, options?: { includeSynthetic?: boolean }): string
  replaceState(input: {
    sessionID: string
    messages: SessionMessage[]
    parts: Record<string, MessagePart[]>
  }): SessionInfo
}

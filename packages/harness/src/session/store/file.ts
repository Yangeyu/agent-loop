import { createID, type AssistantMessage, type MessagePart, type ReasoningPart, type SessionInfo, type SessionMessage, type TextPart, type ToolPart, type UserMessage } from "@harness/types"
import type { ISessionStore } from "./types"
import fs from "node:fs"
import path from "node:path"

interface StoredSession {
  id: string
  parentID?: string
  title: string
  messages: SessionMessage[]
  parts: Record<string, MessagePart[]>
}

export class FileSessionStore implements ISessionStore {
  private dir: string
  private cache = new Map<string, SessionInfo>()

  constructor(dir: string = "./data/sessions") {
    this.dir = dir
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true })
    }
  }

  private filePath(sessionID: string) {
    return path.join(this.dir, `${sessionID}.json`)
  }

  private load(sessionID: string): SessionInfo | null {
    if (this.cache.has(sessionID)) {
      return this.cache.get(sessionID)!
    }
    const file = this.filePath(sessionID)
    if (!fs.existsSync(file)) {
      return null
    }
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf-8")) as StoredSession
      this.cache.set(sessionID, data)
      return data
    } catch {
      return null
    }
  }

  private save(session: SessionInfo) {
    const data: StoredSession = {
      id: session.id,
      parentID: session.parentID,
      title: session.title,
      messages: session.messages,
      parts: session.parts,
    }
    fs.writeFileSync(this.filePath(session.id), JSON.stringify(data, null, 2))
    this.cache.set(session.id, session)
  }

  create(input: { parentID?: string; title: string }) {
    const session: SessionInfo = {
      id: createID(),
      parentID: input.parentID,
      title: input.title,
      messages: [],
      parts: {},
    }
    this.save(session)
    return session
  }

  get(sessionID: string) {
    const session = this.load(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    return session
  }

  list() {
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"))
    const sessions: SessionInfo[] = []
    for (const file of files) {
      const id = file.replace(".json", "")
      try {
        sessions.push(this.get(id))
      } catch {}
    }
    return sessions
  }

  addMessage(sessionID: string, message: SessionMessage) {
    const session = this.get(sessionID)
    session.messages.push(message)
    this.save(session)
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
    this.save(session)
    return session.messages[index] as AssistantMessage
  }

  addPart(sessionID: string, messageID: string, part: MessagePart) {
    const session = this.get(sessionID)
    session.parts[messageID] ||= []
    session.parts[messageID].push(part)
    this.save(session)
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
    this.save(session)
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
    this.save(session)
    return session
  }
}

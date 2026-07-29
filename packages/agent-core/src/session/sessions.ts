/**
 * The Sessions aggregate: the single writer of session state.
 *
 * Every mutation runs the same four steps inside one method — build the next
 * immutable snapshot, persist it, emit the matching StateEvent — so the state
 * channel is complete by construction: there is no way to change a session
 * without the corresponding event, and no way to emit a state event except by
 * changing a session. Snapshots are copy-on-write; readers hold frozen views
 * (enforced by the readonly model types), never live references.
 *
 * Projections (parts, messageText) delegate to the shared pure helpers in
 * model.ts, so the aggregate and every event consumer compute "what does
 * this message say" identically.
 */
import {
  messageText,
  partsOf,
  type AssistantMessage,
  type MessagePart,
  type PartsByMessage,
  type ReasoningPart,
  type SessionInfo,
  type SessionMessage,
  type StateEvent,
  type TextPart,
} from "@agent-core/model"
import type { EventChannel } from "@agent-core/events"
import type { SessionPersistence } from "@agent-core/session/persistence"
import { createID } from "@agent-core/types"

export class Sessions {
  constructor(
    private readonly persistence: SessionPersistence,
    private readonly events: EventChannel<StateEvent>,
  ) {}

  /**
   * Creates a session. A child session (parentID set) joins its parent's
   * delegation tree: rootID is inherited so every event scopes in O(1).
   *
   * @param input - optional parent session id and the display title
   * @returns the created session snapshot
   */
  create(input: { parentID?: string; title: string }): SessionInfo {
    const rootID = input.parentID ? this.get(input.parentID).rootID : undefined
    const id = createID()
    const session: SessionInfo = {
      id,
      parentID: input.parentID,
      rootID: rootID ?? id,
      title: input.title,
      messages: [],
      parts: {},
    }

    this.persistence.persist(session)
    this.events.emit({
      type: "session.created",
      sessionID: session.id,
      rootID: session.rootID,
      session: { id: session.id, parentID: session.parentID, rootID: session.rootID, title: session.title },
    })
    return session
  }

  /**
   * Fetches a session snapshot; throws when it does not exist.
   *
   * @param sessionID - the session to fetch
   * @returns the current immutable snapshot
   */
  get(sessionID: string): SessionInfo {
    const session = this.persistence.read(sessionID)
    if (!session) throw new Error(`Session not found: ${sessionID}`)
    return session
  }

  /** All known sessions. */
  list(): SessionInfo[] {
    return this.persistence.list()
  }

  /**
   * Appends a message to a session.
   *
   * @param sessionID - the owning session
   * @param message - the complete message to append
   * @returns the appended message
   */
  appendMessage<M extends SessionMessage>(sessionID: string, message: M): M {
    const session = this.get(sessionID)
    this.write({ ...session, messages: [...session.messages, message] })
    this.events.emit({ type: "message.created", ...this.envelope(session), message })
    return message
  }

  /**
   * Patches an assistant message (finish, error, structured output, time).
   *
   * @param sessionID - the owning session
   * @param messageID - the assistant message to patch
   * @param patch - the fields to merge
   * @returns the patched message
   */
  updateMessage(sessionID: string, messageID: string, patch: Partial<AssistantMessage>): AssistantMessage {
    const session = this.get(sessionID)
    const index = session.messages.findIndex((message) => message.id === messageID)
    if (index === -1) throw new Error(`Message not found: ${messageID}`)

    const current = session.messages[index]
    if (current.role !== "assistant") throw new Error(`Message is not an assistant message: ${messageID}`)

    const next: AssistantMessage = { ...current, ...patch }
    this.write({ ...session, messages: session.messages.map((message, i) => (i === index ? next : message)) })
    this.events.emit({ type: "message.updated", ...this.envelope(session), message: next })
    return next
  }

  /**
   * Appends a part to a message.
   *
   * @param sessionID - the owning session
   * @param messageID - the owning message
   * @param part - the complete part to append
   * @returns the appended part
   */
  appendPart<P extends MessagePart>(sessionID: string, messageID: string, part: P): P {
    const session = this.get(sessionID)
    this.assertMessage(session, messageID)

    this.write(this.withParts(session, messageID, [...partsOf(session, messageID), part]))
    this.events.emit({ type: "part.created", ...this.envelope(session), messageID, part })
    return part
  }

  /**
   * Folds a text delta into an open text/reasoning part. The high-frequency
   * streaming write: emits `part.delta` rather than a whole-part snapshot.
   *
   * @param sessionID - the owning session
   * @param messageID - the owning message
   * @param partID - the text or reasoning part to extend
   * @param delta - the text to append
   * @returns the part after the fold
   */
  appendDelta(sessionID: string, messageID: string, partID: string, delta: string): TextPart | ReasoningPart {
    const session = this.get(sessionID)
    const parts = partsOf(session, messageID)
    const current = parts.find((part) => part.id === partID)
    if (!current) throw new Error(`Part not found: ${partID}`)
    if (current.type !== "text" && current.type !== "reasoning") {
      throw new Error(`Part ${partID} is not a text part (got: ${current.type})`)
    }

    const next = { ...current, text: current.text + delta }
    this.write(this.withParts(session, messageID, parts.map((part) => (part.id === partID ? next : part))))
    this.events.emit({
      type: "part.delta",
      ...this.envelope(session),
      messageID,
      partID,
      partType: current.type,
      delta,
    })
    return next
  }

  /**
   * Replaces a part wholesale — the write behind every tool-part state
   * transition. Emits the full new part so consumers stay self-healing.
   *
   * @param sessionID - the owning session
   * @param messageID - the owning message
   * @param part - the new part (matched to the old by id)
   * @returns the new part
   */
  replacePart<P extends MessagePart>(sessionID: string, messageID: string, part: P): P {
    const session = this.get(sessionID)
    const parts = partsOf(session, messageID)
    if (!parts.some((item) => item.id === part.id)) throw new Error(`Part not found: ${part.id}`)

    this.write(this.withParts(session, messageID, parts.map((item) => (item.id === part.id ? part : item))))
    this.events.emit({ type: "part.updated", ...this.envelope(session), messageID, part })
    return part
  }

  /**
   * Replaces the session's entire history (compaction). The one mutation that
   * invalidates incremental projections, so the event carries the full new
   * state for consumers to re-seed from.
   *
   * @param sessionID - the session to rewrite
   * @param input - the new messages and parts
   * @returns the session snapshot after the swap
   */
  replaceHistory(sessionID: string, input: { messages: readonly SessionMessage[]; parts: PartsByMessage }): SessionInfo {
    const session = this.get(sessionID)
    const next: SessionInfo = { ...session, messages: input.messages, parts: input.parts }
    this.write(next)
    this.events.emit({ type: "history.replaced", ...this.envelope(session), messages: next.messages, parts: next.parts })
    return next
  }

  /**
   * The parts of one message.
   *
   * @param sessionID - the owning session
   * @param messageID - the owning message
   * @returns the parts in append order (empty when none)
   */
  parts(sessionID: string, messageID: string): readonly MessagePart[] {
    return partsOf(this.get(sessionID), messageID)
  }

  /**
   * A message's concatenated text (the shared canonical projection).
   *
   * @param sessionID - the owning session
   * @param messageID - the owning message
   * @param options.includeSynthetic - include engine-appended notes (default true)
   * @returns the joined text
   */
  messageText(sessionID: string, messageID: string, options?: { includeSynthetic?: boolean }): string {
    return messageText(this.get(sessionID), messageID, options)
  }

  private write(session: SessionInfo) {
    this.persistence.persist(session)
  }

  private envelope(session: SessionInfo) {
    return { sessionID: session.id, rootID: session.rootID }
  }

  private assertMessage(session: SessionInfo, messageID: string) {
    if (!session.messages.some((message) => message.id === messageID)) {
      throw new Error(`Message not found: ${messageID}`)
    }
  }

  private withParts(session: SessionInfo, messageID: string, parts: readonly MessagePart[]): SessionInfo {
    return { ...session, parts: { ...session.parts, [messageID]: parts } }
  }
}

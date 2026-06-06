import type { RuntimeEventBus } from "@harness/runtime/events"
import type { ISessionStore } from "@harness/session/store"
import { createID, type AssistantMessage, type MessagePart, type SessionInfo, type ToolMetadata, type UserMessage } from "@harness/types"

export namespace SessionCompaction {
  export function shouldCompact(session: SessionInfo) {
    return session.messages.length >= 8
  }

  export function process(input: {
    store: ISessionStore
    events: RuntimeEventBus
    session: SessionInfo
    trigger: AssistantMessage
    latestUser: UserMessage
  }) {
    const priorMessages = input.session.messages.filter((message) => message.id !== input.latestUser.id)
    const summary = priorMessages
      .map((message) => summarizeMessage(input.store, input.session.id, message))
      .flat()
      .filter(Boolean)
      .slice(-6)
      .join("\n")

    const compactionPart = {
      id: createID(),
      type: "compaction",
      summary,
    } as const

    input.events.emit({
      type: "compaction",
      sessionID: input.session.id,
      summary,
    })

    input.store.replaceState({
      sessionID: input.session.id,
      messages: [input.latestUser],
      parts: buildCompactedParts(input.session, compactionPart, input.latestUser.id),
    })
  }
}

function summarizeMessage(store: ISessionStore, sessionID: string, message: SessionInfo["messages"][number]) {
  const text = store.getMessageText(sessionID, message.id, { includeSynthetic: false }).trim()
  const parts = store.getParts(sessionID, message.id)

  if (message.role === "user") {
    return [`user: ${text}`]
  }

  const lines = [`assistant: ${text || (message.finish ?? "")}`]
  const toolLines = summarizeToolParts(parts)
  return [...lines, ...toolLines]
}

function summarizeToolParts(parts: MessagePart[]) {
  return parts
    .filter((part) => part.type === "tool")
    .map((part) => {
      const metadataSuffix = summarizeToolMetadata(part.state.metadata)

      if (part.state.status === "completed") {
        const title = part.state.title ? ` (${part.state.title})` : ""
        const output = excerpt(part.state.output)
        return `tool ${part.toolName}${title}${metadataSuffix}: ${output}`
      }

      if (part.state.status === "error") {
        return `tool ${part.toolName}${metadataSuffix} error: ${excerpt(part.state.error.message)}`
      }

      return `tool ${part.toolName}${metadataSuffix}: ${part.state.status}`
    })
}

function summarizeToolMetadata(metadata: ToolMetadata | undefined) {
  if (!metadata) return ""

  const importantEntries = IMPORTANT_METADATA_KEYS.flatMap((key) => {
    const value = metadata[key]
    if (!isSummaryValue(value)) return []
    return [[key, value] as const]
  })

  if (importantEntries.length === 0) return ""

  return ` [${importantEntries.map(([key, value]) => `${key}=${String(value)}`).join(", ")}]`
}

function isSummaryValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}

const IMPORTANT_METADATA_KEYS = [
  "taskId",
  "sessionId",
  "parentSessionId",
  "boardId",
  "sourceDataId",
  "agentName",
  "subagentName",
] as const

function excerpt(text: string, limit: number = 160) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, limit)}...`
}

function buildCompactedParts(
  session: SessionInfo,
  compactionPart: { id: string; type: "compaction"; summary: string },
  latestUserID: string,
) {
  const nextParts: Record<string, SessionInfo["parts"][string]> = {
    [latestUserID]: [compactionPart],
  }

  const latestUserParts = session.parts[latestUserID]
  if (latestUserParts?.length) {
    nextParts[latestUserID] = [compactionPart, ...latestUserParts]
  }

  return nextParts
}

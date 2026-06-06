export type UserBubble = {
  id: string
  role: "user"
  text: string
}

// Wire-contract types are owned by @agent-loop/contracts — the single source of
// truth for the streaming protocol, shared with the backend. UI view-model types
// (bubbles, blocks, drawer state) stay local to the frontend below.
import type { ToolAttachment, ArtifactFile, StreamEvent } from "@agent-loop/contracts"

export type { ToolAttachment, ArtifactFile, StreamEvent }

export type DetailState = {
  label: string
  title: string
  content: string
  subtitle?: string
  loading?: boolean
  error?: string
}

export type ToolCallState = {
  toolCallId: string
  toolName: string
  args?: unknown
  title?: string
  metadata?: Record<string, unknown>
  output?: string
  attachments?: ToolAttachment[]
  error?: {
    message: string
    code?: string
  }
}

export type AssistantTurn = {
  sessionID: string
  messageID: string
  turnID: string
  agent: string
  reasoning: string
  text: string
  toolCalls: ToolCallState[]
  finishReason?: string
  errored?: string
}

export type AssistantCoTBlock = {
  id: string
  kind: "cot"
  sessionID: string
  turnIDs: string[]
}

export type AssistantAnswerBlock = {
  id: string
  kind: "answer"
  turnID: string
}

export type AssistantContentBlock = AssistantCoTBlock | AssistantAnswerBlock

export type AssistantBubble = {
  id: string
  role: "assistant"
  sessionID: string
  messageID?: string
  agent: string
  turns: AssistantTurn[]
  blocks: AssistantContentBlock[]
  taskTitles: Record<string, string>
  finishReason?: string
  errored?: string
}

export type ChatBubble = UserBubble | AssistantBubble

export function isAssistantBubble(item: ChatBubble): item is AssistantBubble {
  return item.role === "assistant"
}

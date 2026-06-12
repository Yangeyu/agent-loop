// Wire-contract types are owned by @agent-loop/contracts — the single source of
// truth for the data model and the streaming protocol, shared with the backend
// and the harness. UI view-model types (bubbles, blocks, drawer state) stay
// local to the frontend below.
import type {
  ArtifactFile,
  LoopEvent,
  StateEvent,
  StreamEvent,
  ToolAttachment,
  ToolPart,
} from "@agent-loop/contracts"

export type { ArtifactFile, LoopEvent, StateEvent, StreamEvent, ToolAttachment }

export type UserBubble = {
  id: string
  role: "user"
  text: string
}

export type DetailState = {
  label: string
  title: string
  content: string
  subtitle?: string
  loading?: boolean
  error?: string
}

/** One tool call's view state, projected from its ToolPart. */
export type ToolCallState = {
  toolCallId: string
  toolName: string
  args?: unknown
  title?: string
  metadata?: Record<string, unknown>
  output?: string
  attachments?: readonly ToolAttachment[]
  error?: {
    message: string
    code?: string
  }
}

/**
 * Projects a tool part into the flat view state the cards render.
 *
 * @param part - the tool part (any lifecycle state)
 * @returns the view state for the tool call card
 */
export function toToolCallState(part: ToolPart): ToolCallState {
  return {
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    args: part.state.input,
    title: part.state.title,
    metadata: part.state.metadata ? { ...part.state.metadata } : undefined,
    output: part.state.status === "completed" ? part.state.output : undefined,
    attachments: part.state.status === "running" ? undefined : part.state.attachments,
    error:
      part.state.status === "error"
        ? { message: part.state.error.message, code: part.state.error.code }
        : undefined,
  }
}

/** One turn (= one assistant message) inside an assistant bubble. */
export type AssistantTurn = {
  sessionID: string
  // The assistant message id — the turn's identity across all events.
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

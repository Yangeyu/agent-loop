import type { RuntimeDeps } from "@harness/runtime/context"
import type { RuntimePlugin } from "@harness/plugin/types"
import type { z } from "zod"

export type Role = "user" | "assistant"

export type FinishReason = "stop" | "tool-calls" | "length" | "error"

export type ProcessorResult = "continue" | "stop" | "compact"

export type TurnPhase = "starting" | "streaming" | "reasoning" | "responding" | "executing-tool" | "finishing"

export type TurnOutcomeReason =
  | "tool_calls"
  | "empty_assistant"
  | "context_limit"
  | "structured_output"
  | "step_budget_reached"
  | "step_budget_reached_without_answer"
  | "assistant_error"
  | "final_text"
  | "completed_without_output"

export type JsonObject = Record<string, unknown>

export type ProviderModel = {
  providerID: string
  modelID: string
}

export type ErrorInfo = {
  message: string
  retryable?: boolean
  code?: string
}

export type ToolMetadata = JsonObject

export type ToolAttachment = {
  mime: string
  filename?: string
  path?: string
  bytes?: number
}

export type TimeInfo = {
  created: number
  completed?: number
}

export type OutputFormat =
  | {
      type: "text"
    }
  | {
      type: "json_schema"
      schema: Record<string, unknown>
    }

export type AgentInfo = {
  name: string
  description?: string
  mode: "primary" | "subagent"
  prompt?: string
  tools?: Record<string, boolean>
  steps?: number
  format?: OutputFormat
}

export type ToolExecuteResult = {
  title?: string
  output: string
  metadata?: ToolMetadata
  attachments?: ToolAttachment[]
}

export type ToolRunningState = {
  status: "pending" | "running"
  input: unknown
  title?: string
  metadata?: ToolMetadata
  time?: {
    start: number
  }
}

export type ToolCompletedState = {
  status: "completed"
  input: unknown
  output: string
  title?: string
  metadata?: ToolMetadata
  attachments?: ToolAttachment[]
  time?: {
    start: number
    end: number
  }
}

export type ToolErrorState = {
  status: "error"
  input: unknown
  error: ErrorInfo
  title?: string
  metadata?: ToolMetadata
  attachments?: ToolAttachment[]
  time?: {
    start: number
    end: number
  }
}

export type ToolState = ToolRunningState | ToolCompletedState | ToolErrorState

export type ToolPart = {
  id: string
  type: "tool"
  toolName: string
  toolCallId: string
  state: ToolState
}

export type SessionHistoryMessage = {
  info: SessionMessage
  parts: MessagePart[]
}

export type ToolContext = RuntimeDeps & {
  sessionID: string
  messageID: string
  turnID: string
  agent: string
  abort: AbortSignal
  toolCallId?: string
  format?: OutputFormat
  messages: SessionHistoryMessage[]
  extra?: JsonObject
  metadata(input: { title?: string; metadata?: ToolMetadata }): Promise<void>
  executeTool(input: { toolName: string; args: unknown; toolCallId?: string }): Promise<
    | {
        status: "completed"
        result: ToolExecuteResult
      }
    | {
        status: "error"
        error: ErrorInfo
      }
  >
}

export type ToolDefinition<TArgs = unknown> = {
  id: string
  description: string
  parameters: z.ZodType<TArgs>
  validate(args: unknown):
    | {
        success: true
        data: TArgs
      }
    | {
        success: false
        error: ErrorInfo
      }
  execute(args: TArgs, ctx: ToolContext): Promise<ToolExecuteResult>
}

export type AnyToolDefinition = ToolDefinition<unknown>

export type RuntimeModule = RuntimePlugin

export type UserMessage = {
  id: string
  role: "user"
  sessionID: string
  agent: string
  model: ProviderModel
  format?: OutputFormat
  time: TimeInfo
}

export type AssistantMessage = {
  id: string
  role: "assistant"
  sessionID: string
  parentID: string
  agent: string
  model: ProviderModel
  finish?: FinishReason
  error?: ErrorInfo
  structured?: unknown
  time: TimeInfo
}

export type TextPart = {
  id: string
  type: "text"
  text: string
  synthetic?: boolean
}

export type ReasoningPart = {
  id: string
  type: "reasoning"
  text: string
}

export type CompactionPart = {
  id: string
  type: "compaction"
  summary: string
}

export type MessagePart = TextPart | ReasoningPart | CompactionPart | ToolPart

export type SessionMessage = UserMessage | AssistantMessage

export type SessionInfo = {
  id: string
  parentID?: string
  title: string
  messages: SessionMessage[]
  parts: Record<string, MessagePart[]>
}

export function createID() {
  return Math.random().toString(36).slice(2, 10)
}

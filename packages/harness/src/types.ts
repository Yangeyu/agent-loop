// Engine-side types. The session data model and event vocabulary live in
// @contracts (the shared leaf); this module re-exports them for harness code
// and adds the engine-only types (tool contracts).
import type { EngineDeps } from "@harness/agent/context"
import type {
  ErrorInfo,
  OutputFormat,
  MessagePart,
  SessionMessage,
  ToolAttachment,
  ToolDisplay,
  ToolDisplayPatch,
  ToolMetadata,
} from "@contracts"
import type { z } from "zod"

export type {
  ArtifactFile,
  AssistantMessage,
  CompactionPart,
  ErrorInfo,
  FinishReason,
  ImagePart,
  ImageSource,
  LoopEvent,
  MessagePart,
  OutputFormat,
  PartsByMessage,
  ProviderModel,
  ReasoningPart,
  SessionInfo,
  SessionMessage,
  SessionMeta,
  SessionProjection,
  StateEvent,
  TextPart,
  TimeInfo,
  ToolAttachment,
  ToolCompletedState,
  ToolDisplay,
  ToolDisplayPatch,
  ToolErrorState,
  ToolMetadata,
  ToolPart,
  ToolRunningState,
  ToolState,
  TurnEndReason,
  TurnPhase,
  UserMessage,
} from "@contracts"

export type JsonObject = Record<string, unknown>

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
  // A patch: the result states how the call went; what it was about was already
  // established by beforeExecute (see resolveDisplay in agent/tool-part.ts).
  display?: ToolDisplayPatch
  output: string
  metadata?: ToolMetadata
  attachments?: ToolAttachment[]
}

export type SessionHistoryMessage = {
  info: SessionMessage
  parts: readonly MessagePart[]
}

export type ToolContext = EngineDeps & {
  sessionID: string
  // The assistant message (turn record) this tool call belongs to.
  messageID: string
  agent: string
  abort: AbortSignal
  toolCallId?: string
  format?: OutputFormat
  messages: SessionHistoryMessage[]
  metadata(input: { display?: ToolDisplayPatch; metadata?: ToolMetadata }): Promise<void>
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

export function createID() {
  return Math.random().toString(36).slice(2, 10)
}

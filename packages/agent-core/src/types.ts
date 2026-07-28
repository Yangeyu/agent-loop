/**
 * The loop's own types: the tool contracts, plus a re-export of the data model
 * (model.ts, the zero-import leaf) so a consumer reaches one place for both.
 */
import type { RuntimeEventBus } from "@agent-core/event/bus"
import type { Sessions } from "@agent-core/session"
import type {
  ErrorInfo,
  OutputFormat,
  MessagePart,
  SessionMessage,
  ToolAttachment,
  ToolDisplayPatch,
  ToolMetadata,
} from "@agent-core/model"
import type { CoreConfig } from "@agent-core/config"
import type { z } from "zod"

export type {
  ActivityStatus,
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
} from "@agent-core/model"

export type ToolExecuteResult = {
  /**
   * A patch: the result states how the call went; what it was about was
   * already established when the tool part opened (see tool-part.ts).
   */
  display?: ToolDisplayPatch
  output: string
  metadata?: ToolMetadata
  attachments?: ToolAttachment[]
}

export type SessionHistoryMessage = {
  info: SessionMessage
  parts: readonly MessagePart[]
}

/**
 * What a tool call may consult: listed explicitly, never derived from the
 * engine's dependencies, so that "a tool needs X" cannot quietly become "the
 * loop must hold X".
 *
 * Anything beyond this a tool holds in its own closure — see
 * createReadTool({ workspace }), createTaskTool({ agents, config }).
 */
export type ToolContext = {
  config: CoreConfig
  sessions: Sessions
  events: RuntimeEventBus
  sessionID: string
  /** The assistant message (turn record) this tool call belongs to. */
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
  /**
   * What this call is about — its verb and target. Pure and synchronous,
   * because it runs before the tool part is opened so that `part.created`
   * already carries the full display. Anything that needs to do work belongs in
   * execute; this only names the call.
   *
   * It takes the args and nothing else: a tool resolving a path the way execute
   * will resolve it does so against the workspace it holds.
   */
  describe?(args: TArgs): ToolDisplayPatch
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

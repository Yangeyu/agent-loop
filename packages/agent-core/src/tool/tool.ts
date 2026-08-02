/**
 * The tool port: what a tool is (ToolDefinition), what a call may consult
 * (ToolContext), and the defineTool factory that turns a zod-typed spec into a
 * definition with uniform validation, error classification, and metadata flow.
 */
import type { RuntimeEventBus } from "@agent-core/events"
import type { Sessions } from "@agent-core/session"
import type {
  ErrorInfo,
  MessagePart,
  OutputFormat,
  SessionMessage,
  ToolAttachment,
  ToolDisplayPatch,
  ToolMetadata,
} from "@agent-core/model"
import type { CoreConfig } from "@agent-core/config"
import { z } from "zod"

// Contract

export type ToolExecuteResult = {
  /**
   * A patch: the result states how the call went; what it was about was
   * already established when the tool part opened (see engine/tool-part.ts).
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
  /** The assistant message (step record) this tool call belongs to. */
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

// Types

type ToolMetadataUpdate = {
  display?: ToolDisplayPatch
  metadata?: ToolMetadata
}

type Awaitable<T> = T | Promise<T>

type ToolHookInput<TArgs> = {
  args: TArgs
  ctx: ToolContext
  toolID: string
}

type ToolMapErrorInput<TArgs> = ToolHookInput<TArgs> & {
  error: unknown
  /** The errno-style code, when the failure carries one (ENOENT, EISDIR, …). */
  code?: string
}

type DefineToolOptions<P extends z.ZodType> = {
  id: string
  description: string
  /**
   * Names the call from its arguments: what it does and what it acts on. Runs
   * before the tool part is opened, so the transcript can show what a call is
   * working on from the moment it appears rather than once it finishes.
   * Must be pure — it is display, not work.
   */
  describe?: (args: z.infer<P>) => ToolDisplayPatch
  parameters: P
  execute: (args: z.infer<P>, ctx: ToolContext) => Promise<ToolExecuteResult>
  beforeExecute?: (input: ToolHookInput<z.infer<P>>) => Awaitable<ToolMetadataUpdate | void>
  /**
   * Classifies the failures this tool recognizes. Returning nothing is the
   * normal case for everything else — defineTool then applies the generic
   * classification, so a tool never has to restate it.
   */
  mapError?: (input: ToolMapErrorInput<z.infer<P>>) => ErrorInfo | undefined
}

// Errors

export class ToolExecutionError extends Error {
  info: ErrorInfo

  constructor(info: ErrorInfo, options?: { cause?: unknown }) {
    super(info.message, options)
    this.name = "ToolExecutionError"
    this.info = info
  }
}

function createToolValidationErrorInfo(toolID: string, error: z.ZodError): ErrorInfo {
  return {
    message: formatToolValidationError(toolID, error),
    retryable: false,
    code: "tool_invalid_args",
  }
}

export function toToolExecutionErrorInfo(toolID: string, error: unknown): ErrorInfo {
  if (error instanceof ToolExecutionError) {
    return error.info
  }

  const message = error instanceof Error ? error.message : String(error)
  return {
    message: `The ${toolID} tool failed: ${message}`,
    retryable: false,
    code: "tool_execution_failed",
  }
}

function formatToolValidationError(toolID: string, error: z.ZodError) {
  return `The ${toolID} tool was called with invalid arguments: ${error.message}. Please rewrite the input so it satisfies the expected schema.`
}

// Public API

export function defineTool<P extends z.ZodType>(
  options: DefineToolOptions<P>,
): ToolDefinition<z.infer<P>> {
  const { id, description, parameters } = options

  return {
    id,
    description,
    describe: options.describe,
    parameters,
    validate(args) {
      return parseToolArgs(id, parameters, args)
    },
    async execute(args, ctx) {
      return await executeTool(options, args, ctx)
    },
  }
}

async function executeTool<P extends z.ZodType>(
  options: DefineToolOptions<P>,
  args: z.infer<P>,
  ctx: ToolContext,
) {
  try {
    await runBeforeExecute(options, args, ctx)
    const result = await options.execute(args, ctx)
    await applyMetadataUpdate(ctx, { display: result.display, metadata: result.metadata })
    return result
  } catch (error) {
    throw wrapToolError(options, args, ctx, error)
  }
}

// Internal helpers

function parseToolArgs<P extends z.ZodType>(toolID: string, parameters: P, args: unknown) {
  const parsed = parameters.safeParse(args)
  if (!parsed.success) {
    return {
      success: false as const,
      error: createToolValidationErrorInfo(toolID, parsed.error),
    }
  }

  return {
    success: true as const,
    data: parsed.data,
  }
}

async function runBeforeExecute<P extends z.ZodType>(
  options: DefineToolOptions<P>,
  args: z.infer<P>,
  ctx: ToolContext,
) {
  await applyMetadataUpdate(
    ctx,
    await options.beforeExecute?.({
      args,
      ctx,
      toolID: options.id,
    }),
  )
}

function wrapToolError<P extends z.ZodType>(
  options: DefineToolOptions<P>,
  args: z.infer<P>,
  ctx: ToolContext,
  error: unknown,
) {
  // A tool that threw a ToolExecutionError has already classified its own
  // failure as precisely as it can. mapError exists to give a stable code to
  // what a tool *could not* classify — the raw errno or library error — so it
  // never runs over an already-typed failure. Letting it would relabel
  // "edit_not_unique" as a generic execution failure, and the caller would lose
  // the one thing that tells it how to fix the call.
  if (error instanceof ToolExecutionError) return error

  return new ToolExecutionError(
    options.mapError?.({
      error,
      code: errnoOf(error),
      args,
      ctx,
      toolID: options.id,
    }) ?? toToolExecutionErrorInfo(options.id, error),
    { cause: error },
  )
}

// Node reports filesystem failures as an errno string on the error object.
// Narrowed once here so nine tools do not each re-narrow `unknown` to read it.
function errnoOf(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code
  return undefined
}

async function applyMetadataUpdate(ctx: ToolContext, update?: ToolMetadataUpdate | void) {
  if (!update) return
  if (update.display === undefined && update.metadata === undefined) return
  await ctx.metadata(update)
}


import type {
  ErrorInfo,
  ToolContext,
  ToolDefinition,
  ToolDisplayPatch,
  ToolExecuteResult,
  ToolMetadata,
} from "@agent-core/types"
import { z } from "zod"

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


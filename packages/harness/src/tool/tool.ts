import type { ErrorInfo, ToolContext, ToolDefinition, ToolExecuteResult, ToolMetadata } from "@harness/types"
import { z } from "zod"

// Types

type ToolMetadataUpdate = {
  title?: string
  metadata?: ToolMetadata
}

type Awaitable<T> = T | Promise<T>

type ToolHookInput<TArgs> = {
  args: TArgs
  ctx: ToolContext
  toolID: string
}

type ToolAfterExecuteInput<TArgs> = ToolHookInput<TArgs> & {
  result: ToolExecuteResult
}

type ToolMapErrorInput<TArgs> = ToolHookInput<TArgs> & {
  error: unknown
}

type ToolTruncateOutputInput<TArgs> = ToolHookInput<TArgs> & {
  output: string
  result: ToolExecuteResult
}

type ToolNormalizeMetadataInput<TArgs> = ToolHookInput<TArgs> & {
  metadata: ToolMetadata | undefined
  result: ToolExecuteResult
}

type ToolNormalizedResultInput<TArgs> = {
  args: TArgs
  ctx: ToolContext
  toolID: string
  result: ToolExecuteResult
  truncateOutput?: DefineToolOptions<z.ZodType<TArgs>>["truncateOutput"]
  normalizeMetadata?: DefineToolOptions<z.ZodType<TArgs>>["normalizeMetadata"]
}

type DefineToolOptions<P extends z.ZodType> = {
  id: string
  description: string
  parameters: P
  execute: (args: z.infer<P>, ctx: ToolContext) => Promise<ToolExecuteResult>
  beforeExecute?: (input: ToolHookInput<z.infer<P>>) => Awaitable<ToolMetadataUpdate | void>
  afterExecute?: (input: ToolAfterExecuteInput<z.infer<P>>) => Awaitable<(Partial<ToolExecuteResult> & ToolMetadataUpdate) | void>
  mapError?: (input: ToolMapErrorInput<z.infer<P>>) => ErrorInfo
  truncateOutput?: number | ((input: ToolTruncateOutputInput<z.infer<P>>) => string)
  normalizeMetadata?: (input: ToolNormalizeMetadataInput<z.infer<P>>) => ToolMetadata | undefined
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

export function createToolValidationErrorInfo(toolID: string, error: z.ZodError): ErrorInfo {
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

export function formatToolValidationError(toolID: string, error: z.ZodError) {
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
    const baseResult = await runToolExecute(options, args, ctx)
    const resultWithHooks = await runAfterExecute(options, args, ctx, baseResult)
    const normalizedResult = finalizeToolResult(options, args, ctx, resultWithHooks)
    await applyMetadataUpdate(ctx, {
      title: normalizedResult.title,
      metadata: normalizedResult.metadata,
    })
    return normalizedResult
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

async function runToolExecute<P extends z.ZodType>(
  options: DefineToolOptions<P>,
  args: z.infer<P>,
  ctx: ToolContext,
) {
  return await options.execute(args, ctx)
}

async function runAfterExecute<P extends z.ZodType>(
  options: DefineToolOptions<P>,
  args: z.infer<P>,
  ctx: ToolContext,
  result: ToolExecuteResult,
) {
  const patch = await options.afterExecute?.({
    args,
    ctx,
    toolID: options.id,
    result,
  })

  return mergeToolResult(result, patch ?? undefined)
}

function finalizeToolResult<P extends z.ZodType>(
  options: DefineToolOptions<P>,
  args: z.infer<P>,
  ctx: ToolContext,
  result: ToolExecuteResult,
) {
  return normalizeToolResult({
    args,
    ctx,
    toolID: options.id,
    result,
    truncateOutput: options.truncateOutput,
    normalizeMetadata: options.normalizeMetadata,
  })
}

function wrapToolError<P extends z.ZodType>(
  options: DefineToolOptions<P>,
  args: z.infer<P>,
  ctx: ToolContext,
  error: unknown,
) {
  return new ToolExecutionError(
    options.mapError?.({
      error,
      args,
      ctx,
      toolID: options.id,
    }) ?? toToolExecutionErrorInfo(options.id, error),
    { cause: error },
  )
}

function mergeToolResult(result: ToolExecuteResult, patch?: Partial<ToolExecuteResult>) {
  if (!patch) return result

  return {
    ...result,
    ...patch,
    metadata: mergeMetadata(result.metadata, patch.metadata),
  }
}

async function applyMetadataUpdate(ctx: ToolContext, update?: ToolMetadataUpdate | void) {
  if (!update) return
  if (update.title === undefined && update.metadata === undefined) return
  await ctx.metadata(update)
}

function normalizeToolResult<TArgs>(input: ToolNormalizedResultInput<TArgs>): ToolExecuteResult {
  const output = normalizeOutput(input)
  const metadata = input.normalizeMetadata
    ? input.normalizeMetadata({
        metadata: input.result.metadata,
        args: input.args,
        ctx: input.ctx,
        toolID: input.toolID,
        result: input.result,
      })
    : input.result.metadata

  return {
    ...input.result,
    output,
    metadata,
  }
}

function mergeMetadata(base: ToolMetadata | undefined, patch: ToolMetadata | undefined) {
  if (base === undefined) return patch
  if (patch === undefined) return base

  return {
    ...base,
    ...patch,
  }
}

function normalizeOutput<TArgs>(input: ToolNormalizedResultInput<TArgs>) {
  if (typeof input.truncateOutput === "function") {
    return input.truncateOutput({
      output: input.result.output,
      args: input.args,
      ctx: input.ctx,
      toolID: input.toolID,
      result: input.result,
    })
  }

  if (typeof input.truncateOutput === "number") {
    return truncateText(input.result.output, input.truncateOutput)
  }

  return input.result.output
}

function truncateText(text: string, limit: number) {
  if (limit < 0 || text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n[truncated ${text.length - limit} characters]`
}

import type { ErrorInfo, ToolExecuteResult, ToolMetadata, ToolPart } from "@harness/types"

type ToolPartBase = {
  id: string
  toolName: string
  toolCallId: string
}

type RunningToolPartInput = ToolPartBase & {
  input: unknown
  title?: string
  metadata?: ToolMetadata
  startedAt: number
}

export function createRunningToolPart(input: RunningToolPartInput): ToolPart {
  return {
    id: input.id,
    type: "tool",
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    state: {
      status: "running",
      input: input.input,
      title: input.title,
      metadata: input.metadata,
      time: {
        start: input.startedAt,
      },
    },
  }
}

export function toRunningToolPart(part: ToolPart, input: unknown): ToolPart {
  return {
    ...part,
    state: {
      status: "running",
      input,
      title: part.state.title,
      metadata: part.state.metadata,
      time: {
        start: part.state.time?.start ?? Date.now(),
      },
    },
  }
}

export function toCompletedToolPart(part: ToolPart, input: unknown, result: ToolExecuteResult): ToolPart {
  return {
    ...part,
    state: {
      status: "completed",
      input,
      output: result.output,
      title: result.title ?? part.state.title,
      metadata: mergeMetadata(part.state.metadata, result.metadata),
      attachments: result.attachments,
      time: {
        start: part.state.time?.start ?? Date.now(),
        end: Date.now(),
      },
    },
  }
}

export function toErroredToolPart(
  part: ToolPart,
  input: unknown,
  error: ErrorInfo,
): ToolPart {
  return {
    ...part,
    state: {
      status: "error",
      input,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
      title: part.state.title,
      metadata: part.state.metadata,
      attachments: part.state.status === "completed" ? part.state.attachments : undefined,
      time: {
        start: part.state.time?.start ?? Date.now(),
        end: Date.now(),
      },
    },
  }
}

export function toMetadataPatchedToolPart(part: ToolPart, input: { title?: string; metadata?: ToolMetadata }): ToolPart {
  const nextTitle = input.title === undefined ? part.state.title : input.title
  const nextMetadata = mergeMetadata(part.state.metadata, input.metadata)

  return {
    ...part,
    state: {
      ...part.state,
      title: nextTitle,
      metadata: nextMetadata,
    },
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

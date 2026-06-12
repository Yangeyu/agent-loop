/**
 * A tool part's lifecycle, in two layers. The pure transitions (running →
 * completed / error, plus metadata patches) each return a new ToolPart rather
 * than mutating — they are the reducer over a call's lifecycle facts.
 * `ToolPartTracker` is the stateful owner that threads those transitions over a
 * single in-memory snapshot and writes each result through the Sessions
 * aggregate — so every transition lands in the store *and* on the state channel
 * (part.created / part.updated) in one step, with no hand-written mirror events.
 */
import type { Sessions } from "@harness/session"
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

/**
 * Builds a fresh tool part in the `running` state from scratch.
 *
 * @param input - identity (id/toolName/toolCallId), call input, and start time
 * @returns a new running ToolPart
 */
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

/**
 * Transitions an existing part to `running` with validated input, preserving its
 * title/metadata and original start time.
 *
 * @param part - the prior tool part
 * @param input - the validated tool input
 * @returns the part in the running state
 */
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

/**
 * Transitions a part to `completed`, folding the execute result's output, title,
 * metadata (merged over the prior), and attachments in, and stamping the end time.
 *
 * @param part - the running tool part
 * @param input - the validated tool input
 * @param result - the tool's execute result
 * @returns the part in the completed state
 */
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

/**
 * Transitions a part to `error`, recording the error info and stamping the end
 * time; keeps any attachments from a prior completed state.
 *
 * @param part - the prior tool part
 * @param input - the tool input that was attempted
 * @param error - the classified error info
 * @returns the part in the error state
 */
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

/**
 * Patches a part's title/metadata in place (same status), for a beforeExecute hook
 * that annotates a running call. Undefined fields leave the prior value untouched.
 *
 * @param part - the tool part to patch
 * @param input - optional title and metadata to merge in
 * @returns the part with patched title/metadata
 */
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

/**
 * Owns one tool call's part across its lifecycle. It holds the live snapshot in
 * memory, applies a transition and writes the whole part through the aggregate
 * on each step, and hands the new snapshot back to the caller.
 *
 * Being the sole writer of this part — and the sole reader of its own snapshot —
 * is what lets concurrent metadata patches and the terminal transition coexist
 * without re-reading the store to reconcile. Every write doubles as the state
 * event (part.created on open, part.updated per transition).
 */
export class ToolPartTracker {
  private current: ToolPart

  constructor(
    private readonly sessions: Sessions,
    private readonly sessionID: string,
    private readonly messageID: string,
    input: RunningToolPartInput,
  ) {
    this.current = sessions.appendPart(sessionID, messageID, createRunningToolPart(input))
  }

  /** The live snapshot — identity and current state of the tracked part. */
  get part(): ToolPart {
    return this.current
  }

  /** Transitions to `running` with validated input. */
  toRunning(input: unknown): ToolPart {
    return this.write(toRunningToolPart(this.current, input))
  }

  /** Transitions to `completed`, folding in the execute result. */
  toCompleted(input: unknown, result: ToolExecuteResult): ToolPart {
    return this.write(toCompletedToolPart(this.current, input, result))
  }

  /** Transitions to `error`, recording the classified error info. */
  toErrored(input: unknown, error: ErrorInfo): ToolPart {
    return this.write(toErroredToolPart(this.current, input, error))
  }

  /** Patches the live snapshot's title/metadata in place (same status). */
  patchMetadata(patch: { title?: string; metadata?: ToolMetadata }): ToolPart {
    return this.write(toMetadataPatchedToolPart(this.current, patch))
  }

  private write(next: ToolPart): ToolPart {
    this.current = this.sessions.replacePart(this.sessionID, this.messageID, next)
    return this.current
  }
}

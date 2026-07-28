/**
 * A tool part's lifecycle, in two layers. The pure transitions (running →
 * completed / error, plus metadata patches) each return a new ToolPart rather
 * than mutating — they are the reducer over a call's lifecycle facts.
 * `ToolPartTracker` is the stateful owner that threads those transitions over a
 * single in-memory snapshot and writes each result through the Sessions
 * aggregate — so every transition lands in the store *and* on the state channel
 * (part.created / part.updated) in one step, with no hand-written mirror events.
 */
import type { Sessions } from "@agent-core/session"
import type { ErrorInfo, ToolDisplay, ToolDisplayPatch, ToolExecuteResult, ToolMetadata, ToolPart } from "@agent-core/types"

type ToolPartBase = {
  id: string
  toolName: string
  toolCallId: string
}

type RunningToolPartInput = ToolPartBase & {
  input: unknown
  display?: ToolDisplayPatch
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
      display: resolveDisplay(input.toolName, undefined, input.display),
      metadata: input.metadata,
      time: {
        start: input.startedAt,
      },
    },
  }
}

/**
 * Transitions a part to `completed`, folding the execute result's output, display,
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
      display: resolveDisplay(part.toolName, part.state.display, result.display),
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
      display: part.state.display,
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
 * Patches a part's display/metadata in place (same status), for a beforeExecute
 * hook that annotates a running call. Undefined fields leave the prior value
 * untouched.
 *
 * @param part - the tool part to patch
 * @param input - optional display and metadata to merge in
 * @returns the part with patched display/metadata
 */
export function toMetadataPatchedToolPart(part: ToolPart, input: { display?: ToolDisplayPatch; metadata?: ToolMetadata }): ToolPart {
  return {
    ...part,
    state: {
      ...part.state,
      display: resolveDisplay(part.toolName, part.state.display, input.display),
      metadata: mergeMetadata(part.state.metadata, input.metadata),
    },
  }
}

// Folds a display patch onto what a call has established so far. Two rules make
// the pieces compose: a later patch refines the earlier one field by field (so
// `describe` states the target and the result adds only the summary), and an
// undeclared verb falls back to the tool's own name, so a tool that says
// nothing about its display still renders as itself.
function resolveDisplay(
  toolName: string,
  base: ToolDisplay | undefined,
  patch: ToolDisplayPatch | undefined,
): ToolDisplay {
  return {
    verb: patch?.verb ?? base?.verb ?? toolName,
    target: patch?.target ?? base?.target,
    summary: patch?.summary ?? base?.summary,
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

  /** Transitions to `completed`, folding in the execute result. */
  toCompleted(input: unknown, result: ToolExecuteResult): ToolPart {
    return this.write(toCompletedToolPart(this.current, input, result))
  }

  /** Transitions to `error`, recording the classified error info. */
  toErrored(input: unknown, error: ErrorInfo): ToolPart {
    return this.write(toErroredToolPart(this.current, input, error))
  }

  /** Patches the live snapshot's display/metadata in place (same status). */
  patchMetadata(patch: { display?: ToolDisplayPatch; metadata?: ToolMetadata }): ToolPart {
    return this.write(toMetadataPatchedToolPart(this.current, patch))
  }

  private write(next: ToolPart): ToolPart {
    this.current = this.sessions.replacePart(this.sessionID, this.messageID, next)
    return this.current
  }
}

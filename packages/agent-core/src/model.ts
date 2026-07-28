// The shared vocabulary for the whole chain: the session data model, the two
// event channels (state + loop), and the pure projection that folds state
// events back into session state.
//
// Pure types and pure functions only — no runtime dependencies, no node/bun
// globals — so any consumer, in or out of this process, imports the same
// definitions. This file is the single source of truth: the harness emits these
// events and every consumer projects state with the same reducer.

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type ProviderModel = {
  readonly providerID: string
  readonly modelID: string
}

export type ErrorInfo = {
  readonly message: string
  readonly retryable?: boolean
  readonly code?: string
}

export type TimeInfo = {
  readonly created: number
  readonly completed?: number
}

export type OutputFormat =
  | { readonly type: "text" }
  | { readonly type: "json_schema"; readonly schema: Readonly<Record<string, unknown>> }

export type ToolMetadata = Readonly<Record<string, unknown>>

/**
 * What a tool call is doing, in the tool's own terms — the semantic half of a
 * transcript row. A tool knows what it operated on and how that turned out; it
 * does not know the viewport, so it states facts and never formats them.
 *
 * Truncation, separators, column widths and colour belong to the surface: the
 * same call renders differently in an 80-column terminal and a 200-column one,
 * and a tool that pre-rendered its own label would freeze one of those choices
 * for every consumer.
 */
export type ToolDisplay = {
  /** The action, as one lowercase word: `read`, `write`, `grep`, `subagent`. */
  readonly verb: string
  /** What it acted on, unabridged — a full path, pattern, or query. */
  readonly target?: string
  /** How it turned out, in the tool's terms: `31.1 KB`, `exit 0`, `3 matches`. */
  readonly summary?: string
  /**
   * Consecutive calls sharing a key are one logical operation and fold into a
   * single transcript row (every append to one file is one "write"). Omit when
   * each call stands on its own.
   */
}

/**
 * A partial display update. `beforeExecute` states what the call is about
 * before it runs; the result fills in how it went. Absent fields keep whatever
 * the earlier update established, so neither side has to restate the other.
 */
export type ToolDisplayPatch = Partial<ToolDisplay>

export type ToolAttachment = {
  readonly mime: string
  readonly filename?: string
  readonly path?: string
  readonly bytes?: number
}

// ---------------------------------------------------------------------------
// Session data model
// ---------------------------------------------------------------------------
// Messages carry no back-reference to their session: ownership is expressed
// once, by containment in SessionInfo. An assistant message records the turn
// that produced it — there is no separate "turn" entity, so every event that
// touches turn output points at the assistant message's id.

export type UserMessage = {
  readonly id: string
  readonly role: "user"
  readonly agent: string
  readonly format?: OutputFormat
  readonly time: TimeInfo
}

export type AssistantMessage = {
  readonly id: string
  readonly role: "assistant"
  // The user message this turn answers.
  readonly parentID: string
  readonly agent: string
  readonly model: ProviderModel
  readonly finish?: FinishReason
  readonly error?: ErrorInfo
  readonly structured?: unknown
  readonly time: TimeInfo
}

export type SessionMessage = UserMessage | AssistantMessage

export type TextPart = {
  readonly id: string
  readonly type: "text"
  readonly text: string
  readonly synthetic?: boolean
}

export type ReasoningPart = {
  readonly id: string
  readonly type: "reasoning"
  readonly text: string
}

export type CompactionPart = {
  readonly id: string
  readonly type: "compaction"
  readonly summary: string
}

/**
 * An image attached to a message, in one of three source forms. `file` is a
 * local path (resolved to base64 before reaching the provider), `base64` is
 * inline bytes, `url` is a remote link passed to the model as-is.
 */
export type ImageSource =
  | { readonly kind: "file"; readonly path: string; readonly mime: string }
  | { readonly kind: "base64"; readonly data: string; readonly mime: string }
  | { readonly kind: "url"; readonly url: string; readonly mime?: string }

export type ImagePart = {
  readonly id: string
  readonly type: "image"
  readonly source: ImageSource
}

export type ToolRunningState = {
  readonly status: "running"
  readonly input: unknown
  readonly display: ToolDisplay
  readonly metadata?: ToolMetadata
  readonly time?: { readonly start: number }
}

export type ToolCompletedState = {
  readonly status: "completed"
  readonly input: unknown
  readonly output: string
  readonly display: ToolDisplay
  readonly metadata?: ToolMetadata
  readonly attachments?: readonly ToolAttachment[]
  readonly time?: { readonly start: number; readonly end: number }
}

export type ToolErrorState = {
  readonly status: "error"
  readonly input: unknown
  readonly error: ErrorInfo
  readonly display: ToolDisplay
  readonly metadata?: ToolMetadata
  readonly attachments?: readonly ToolAttachment[]
  readonly time?: { readonly start: number; readonly end: number }
}

export type ToolState = ToolRunningState | ToolCompletedState | ToolErrorState

export type ToolPart = {
  readonly id: string
  readonly type: "tool"
  readonly toolName: string
  readonly toolCallId: string
  readonly state: ToolState
}

export type MessagePart = TextPart | ReasoningPart | CompactionPart | ImagePart | ToolPart

export type PartsByMessage = Readonly<Record<string, readonly MessagePart[]>>

export type SessionInfo = {
  readonly id: string
  readonly parentID?: string
  // The root of this session's delegation tree (= id for a root session).
  // Stamped at creation so consumers can scope events without walking parents.
  readonly rootID: string
  readonly title: string
  readonly messages: readonly SessionMessage[]
  readonly parts: PartsByMessage
}

// ---------------------------------------------------------------------------
// Loop vocabulary
// ---------------------------------------------------------------------------

export type FinishReason = "stop" | "tool-calls" | "length" | "error"

export type TurnPhase = "starting" | "streaming" | "reasoning" | "responding" | "executing-tool" | "finishing"

/**
 * How a turn terminated: a model finish, a failure, or an abort. Exactly one
 * `turn.end` is emitted per turn, with this discriminant.
 */
export type TurnEndReason = "finish" | "error" | "abort"

// ---------------------------------------------------------------------------
// State events — emitted by the session aggregate, the single writer.
// ---------------------------------------------------------------------------
// Every session mutation produces exactly one of these as a side effect of the
// write itself, so the stream is complete by construction: folding it with
// `applyStateEvent` reproduces the stored session. Identity is store identity:
// sessionID / messageID / partID, where messageID is always the message being
// mutated. High-frequency text accumulates as `part.delta`; everything else
// travels as a whole-object snapshot, so a lost frame is healed by the next.

export type StateEnvelope = {
  readonly sessionID: string
  readonly rootID: string
}

export type SessionMeta = {
  readonly id: string
  readonly parentID?: string
  readonly rootID: string
  readonly title: string
}

export type StateEvent =
  | (StateEnvelope & { readonly type: "session.created"; readonly session: SessionMeta })
  | (StateEnvelope & { readonly type: "message.created"; readonly message: SessionMessage })
  | (StateEnvelope & { readonly type: "message.updated"; readonly message: SessionMessage })
  | (StateEnvelope & { readonly type: "part.created"; readonly messageID: string; readonly part: MessagePart })
  | (StateEnvelope & {
      readonly type: "part.delta"
      readonly messageID: string
      readonly partID: string
      // Denormalized so delta consumers need not track part kinds themselves.
      readonly partType: "text" | "reasoning"
      readonly delta: string
    })
  | (StateEnvelope & { readonly type: "part.updated"; readonly messageID: string; readonly part: MessagePart })
  | (StateEnvelope & {
      readonly type: "history.replaced"
      readonly messages: readonly SessionMessage[]
      readonly parts: PartsByMessage
    })

// ---------------------------------------------------------------------------
// Loop events — emitted by the engine; the live activity protocol of the loop.
// ---------------------------------------------------------------------------
// Loop events answer "what is the loop busy with right now" and nothing more:
// a run began, a turn began, the turn changed phase, a participant reported an
// activity, the turn ended. Every fact that must survive replay travels on the
// state channel instead. `messageID` is the assistant message the turn produces.

export type LoopEnvelope = {
  readonly sessionID: string
  readonly rootID: string
  readonly agent: string
}

/** The three points of one reported activity. */
export type ActivityStatus = "start" | "update" | "end"

export type LoopEvent =
  | (LoopEnvelope & { readonly type: "session.start"; readonly text: string })
  | (LoopEnvelope & {
      readonly type: "turn.start"
      readonly messageID: string
      readonly step: number
      // The step cap this turn runs under, so a consumer can show progress
      // against the budget.
      readonly maxSteps: number
    })
  | (LoopEnvelope & { readonly type: "turn.phase"; readonly messageID: string; readonly phase: TurnPhase })
  // What a participant other than the loop itself is busy with. `phase` covers
  // the loop's own steps; this covers everything the loop delegates —
  // compacting history, retrying a model call. The payload is semantic, like
  // ToolDisplay: a consumer renders it without branching on who produced it.
  | (LoopEnvelope & {
      readonly type: "turn.activity"
      readonly messageID: string
      // The producer, for correlating one activity's start/update/end.
      readonly source: string
      readonly status: ActivityStatus
      // What it is doing, in the producer's own words: "compacting history".
      readonly label: string
      // Optional refinement: "attempt 2 of 3", "12k → 4k tokens".
      readonly detail?: string
    })
  | (LoopEnvelope & {
      readonly type: "turn.end"
      readonly messageID: string
      readonly step: number
      readonly reason: TurnEndReason
      readonly finishReason?: FinishReason
      readonly error?: string
      readonly durationMs: number
      readonly toolCalls: number
    })

// ---------------------------------------------------------------------------
// Projection — the one reducer every consumer shares.
// ---------------------------------------------------------------------------

/** The foldable view of one session's content: messages plus parts by message. */
export type SessionProjection = {
  readonly messages: readonly SessionMessage[]
  readonly parts: PartsByMessage
}

/** The empty projection a fold starts from. */
export const emptyProjection: SessionProjection = { messages: [], parts: {} }

/**
 * Folds one state event into a session projection. Pure: returns a new
 * projection, never mutates. Folding a session's full state-event stream from
 * `emptyProjection` reproduces the stored session's messages and parts.
 *
 * @param projection - the projection so far
 * @param event - the state event to apply
 * @returns the next projection
 */
export function applyStateEvent(projection: SessionProjection, event: StateEvent): SessionProjection {
  switch (event.type) {
    case "session.created":
      return projection
    case "message.created":
      return { ...projection, messages: [...projection.messages, event.message] }
    case "message.updated":
      return {
        ...projection,
        messages: projection.messages.map((message) => (message.id === event.message.id ? event.message : message)),
      }
    case "part.created":
      return withParts(projection, event.messageID, [...partsOf(projection, event.messageID), event.part])
    case "part.delta":
      return withParts(
        projection,
        event.messageID,
        partsOf(projection, event.messageID).map((part) =>
          part.id === event.partID && (part.type === "text" || part.type === "reasoning")
            ? { ...part, text: part.text + event.delta }
            : part,
        ),
      )
    case "part.updated":
      return withParts(
        projection,
        event.messageID,
        partsOf(projection, event.messageID).map((part) => (part.id === event.part.id ? event.part : part)),
      )
    case "history.replaced":
      return { messages: event.messages, parts: event.parts }
  }
}

/**
 * The parts of one message within a projection.
 *
 * @param projection - the projection to read
 * @param messageID - the owning message
 * @returns the message's parts, in append order (empty when none)
 */
export function partsOf(projection: SessionProjection, messageID: string): readonly MessagePart[] {
  return projection.parts[messageID] ?? []
}

/**
 * Concatenates a message's text parts. The canonical definition of "what the
 * message says" — the aggregate's projection and every UI use this one filter.
 *
 * @param projection - the projection to read
 * @param messageID - the owning message
 * @param options.includeSynthetic - include engine-appended notes (default true)
 * @returns the joined text
 */
export function messageText(
  projection: SessionProjection,
  messageID: string,
  options?: { includeSynthetic?: boolean },
): string {
  return partsOf(projection, messageID)
    .filter((part): part is TextPart => part.type === "text")
    .filter((part) => options?.includeSynthetic !== false || part.synthetic !== true)
    .map((part) => part.text)
    .join("")
}

function withParts(
  projection: SessionProjection,
  messageID: string,
  parts: readonly MessagePart[],
): SessionProjection {
  return { ...projection, parts: { ...projection.parts, [messageID]: parts } }
}

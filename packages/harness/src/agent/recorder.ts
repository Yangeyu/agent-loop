/**
 * TurnRecorder: the single owner of one turn's lifecycle.
 *
 * It is the only engine object that writes turn output — the assistant message,
 * its text/reasoning parts, and (via trackToolCall) tool parts — and the only
 * emitter of turn-scoped loop telemetry (turn.start / turn.phase / turn.end).
 * Content writes go through the Sessions aggregate, so state events fall out of
 * the writes themselves; the recorder never emits state by hand.
 *
 * Construction appends the assistant message and emits turn.start; exactly one
 * of finish / fail / abort terminates the turn (later terminals are ignored, so
 * an abort racing a finish cannot double-report). All accumulation state that
 * previously shadowed the store on the turn context — phase, open part cursors,
 * counters — lives here, with the store as the only other copy.
 */
import { ToolPartTracker } from "@harness/agent/tool-part"
import type { EventChannel } from "@harness/event/bus"
import type { Sessions } from "@harness/session"
import {
  createID,
  type AssistantMessage,
  type ErrorInfo,
  type FinishReason,
  type LoopEvent,
  type ReasoningPart,
  type TextPart,
  type TurnPhase,
} from "@harness/types"

const VALID_PHASE_TRANSITIONS: Record<TurnPhase, TurnPhase[]> = {
  starting: ["streaming", "finishing"],
  streaming: ["reasoning", "responding", "executing-tool", "finishing"],
  reasoning: ["streaming", "responding", "executing-tool", "finishing"],
  responding: ["streaming", "executing-tool", "finishing"],
  "executing-tool": ["streaming", "finishing"],
  finishing: [],
}

export class TurnRecorder {
  private phase: TurnPhase = "starting"
  private textPart?: TextPart
  private reasoningPart?: ReasoningPart
  private sawText = false
  private sawReasoning = false
  private toolCallCount = 0
  private retryCount = 0
  private ended = false
  private readonly startedAt = Date.now()
  private current: AssistantMessage

  constructor(
    private readonly input: {
      sessions: Sessions
      loop: EventChannel<LoopEvent>
      sessionID: string
      rootID: string
      agent: string
      step: number
      maxSteps: number
      assistant: AssistantMessage
    },
  ) {
    this.current = input.sessions.appendMessage(input.sessionID, input.assistant)
    input.loop.emit({
      type: "turn.start",
      ...this.envelope(),
      messageID: this.current.id,
      step: input.step,
      maxSteps: input.maxSteps,
    })
  }

  /** The current snapshot of this turn's assistant message. */
  get assistant(): AssistantMessage {
    return this.current
  }

  /** The assistant message id — the turn's identity in events and hooks. */
  get messageID(): string {
    return this.current.id
  }

  /** How many tool calls this turn has issued. */
  get toolCalls(): number {
    return this.toolCallCount
  }

  /** How many model-call retries this turn has recorded. */
  get retries(): number {
    return this.retryCount
  }

  /**
   * Moves the turn to a new phase, validating the transition, and emits
   * turn.phase. Re-entering the current phase is a no-op.
   */
  enterPhase(phase: TurnPhase) {
    if (this.phase === phase) return
    const allowed = VALID_PHASE_TRANSITIONS[this.phase]
    if (!allowed.includes(phase)) {
      throw new Error(`Invalid turn phase transition: ${this.phase} -> ${phase}`)
    }

    this.phase = phase
    this.input.loop.emit({ type: "turn.phase", ...this.envelope(), messageID: this.messageID, phase })
  }

  /** Streams a reasoning delta into the open reasoning part (opening one if needed). */
  appendReasoning(delta: string) {
    if (!this.sawReasoning) {
      this.sawReasoning = true
      this.enterPhase("reasoning")
    }

    if (!this.reasoningPart) {
      this.textPart = undefined
      this.reasoningPart = this.input.sessions.appendPart(this.input.sessionID, this.messageID, {
        id: createID(),
        type: "reasoning",
        text: "",
      })
    }

    this.reasoningPart = this.input.sessions.appendDelta(
      this.input.sessionID,
      this.messageID,
      this.reasoningPart.id,
      delta,
    ) as ReasoningPart
  }

  /** Streams a text delta into the open text part (opening one if needed). */
  appendText(delta: string, options?: { synthetic?: boolean }) {
    if (!this.sawText) {
      this.sawText = true
      this.enterPhase("responding")
    }

    this.reasoningPart = undefined
    if (!this.textPart) {
      this.textPart = this.input.sessions.appendPart(this.input.sessionID, this.messageID, {
        id: createID(),
        type: "text",
        text: "",
        synthetic: options?.synthetic,
      })
    }

    this.textPart = this.input.sessions.appendDelta(
      this.input.sessionID,
      this.messageID,
      this.textPart.id,
      delta,
    ) as TextPart
  }

  /**
   * Appends a synthetic stop note as its own part (engine notes never extend
   * the model's streamed text).
   */
  appendNote(note: string) {
    this.input.sessions.appendPart(this.input.sessionID, this.messageID, {
      id: createID(),
      type: "text",
      text: note,
      synthetic: true,
    })
  }

  /**
   * Opens a tool part for a new call and returns its tracker. Closes the
   * text/reasoning cursors: any later stream text starts a fresh part.
   *
   * @param call - the tool name, call id, and raw args from the stream
   * @returns the tracker owning that part's lifecycle
   */
  trackToolCall(call: { toolName: string; toolCallId: string; args: unknown }): ToolPartTracker {
    this.textPart = undefined
    this.reasoningPart = undefined
    this.toolCallCount += 1

    return new ToolPartTracker(this.input.sessions, this.input.sessionID, this.messageID, {
      id: createID(),
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      input: call.args,
      startedAt: Date.now(),
    })
  }

  /** Records a model-call retry (feeds the retry budget check). */
  recordRetry() {
    this.retryCount += 1
  }

  /** Terminates the turn as finished (model completed), optionally with structured output. */
  finish(finishReason: FinishReason, structured?: unknown) {
    this.terminate(
      {
        finish: finishReason,
        ...(structured !== undefined ? { structured } : {}),
      },
      { reason: "finish", finishReason },
    )
  }

  /** Terminates the turn as failed, recording the error on the assistant message. */
  fail(error: ErrorInfo) {
    this.terminate({ error, finish: "error" }, { reason: "error", error: error.message })
  }

  /** Terminates the turn as aborted. */
  abort() {
    this.terminate(
      { error: { message: "Aborted", retryable: false, code: "aborted" }, finish: "error" },
      { reason: "abort" },
    )
  }

  private terminate(
    patch: Partial<AssistantMessage>,
    end: { reason: "finish" | "error" | "abort"; finishReason?: FinishReason; error?: string },
  ) {
    if (this.ended) return
    this.ended = true

    this.enterPhase("finishing")
    this.current = this.input.sessions.updateMessage(this.input.sessionID, this.messageID, {
      ...patch,
      time: { ...this.current.time, completed: Date.now() },
    })

    this.input.loop.emit({
      type: "turn.end",
      ...this.envelope(),
      messageID: this.messageID,
      step: this.input.step,
      ...end,
      durationMs: Date.now() - this.startedAt,
      toolCalls: this.toolCallCount,
    })
  }

  private envelope() {
    return { sessionID: this.input.sessionID, rootID: this.input.rootID, agent: this.input.agent }
  }
}

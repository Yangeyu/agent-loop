// StreamSink accumulates the model stream (reasoning / text) into the session
// store, manages turn phase transitions, and emits the corresponding events.
// It is agent-agnostic and owns no business policy (structured output, budgets,
// and outcome decisions all live in middleware).
import type { TurnContext } from "@harness/core/context"
import { createID, type ErrorInfo, type ReasoningPart, type TextPart, type TurnPhase } from "@harness/types"

const VALID_PHASE_TRANSITIONS: Record<TurnPhase, TurnPhase[]> = {
  starting: ["streaming", "finishing"],
  streaming: ["reasoning", "responding", "executing-tool", "finishing"],
  reasoning: ["streaming", "responding", "executing-tool", "finishing"],
  responding: ["streaming", "executing-tool", "finishing"],
  "executing-tool": ["streaming", "finishing"],
  finishing: [],
}

export class StreamSink {
  constructor(private readonly ctx: TurnContext) {}

  private base() {
    return {
      sessionID: this.ctx.sessionID,
      agent: this.ctx.agent.name,
      messageID: this.ctx.assistant.parentID,
      turnID: this.ctx.assistant.id,
    }
  }

  start() {
    this.ctx.events.emit({
      type: "turn-start",
      ...this.base(),
      step: this.ctx.step,
    })
  }

  enterPhase(phase: TurnPhase) {
    if (this.ctx.phase === phase) return
    const allowed = VALID_PHASE_TRANSITIONS[this.ctx.phase]
    if (!allowed.includes(phase)) {
      throw new Error(`Invalid turn phase transition: ${this.ctx.phase} -> ${phase}`)
    }

    this.ctx.phase = phase
    this.ctx.events.emit({ type: "turn-phase", ...this.base(), phase })
  }

  appendReasoning(textDelta: string) {
    if (!this.ctx.sawReasoning) {
      this.ctx.sawReasoning = true
      this.enterPhase("reasoning")
    }

    this.ctx.events.emit({ type: "reasoning", ...this.base(), textDelta })

    if (!this.ctx.reasoningPart) {
      this.ctx.textPart = undefined
      this.ctx.reasoningPart = this.ctx.session_store.appendReasoningPart(this.ctx.sessionID, this.ctx.assistant.id, {
        id: createID(),
        type: "reasoning",
        text: "",
      })
    }

    const currentPart = this.ctx.reasoningPart
    if (!currentPart) return

    this.ctx.reasoningPart = this.ctx.session_store.updatePart(
      this.ctx.sessionID,
      this.ctx.assistant.id,
      currentPart.id,
      { text: currentPart.text + textDelta },
    ) as ReasoningPart
  }

  appendText(textDelta: string, options?: { synthetic?: boolean }) {
    if (!this.ctx.sawText) {
      this.ctx.sawText = true
      this.enterPhase("responding")
    }

    this.ctx.events.emit({ type: "text", ...this.base(), textDelta })

    this.ctx.reasoningPart = undefined
    if (!this.ctx.textPart) {
      this.ctx.textPart = this.ctx.session_store.appendTextPart(this.ctx.sessionID, this.ctx.assistant.id, {
        id: createID(),
        type: "text",
        text: "",
        synthetic: options?.synthetic,
      })
    }

    const currentPart = this.ctx.textPart
    if (!currentPart) return

    this.ctx.textPart = this.ctx.session_store.updatePart(
      this.ctx.sessionID,
      this.ctx.assistant.id,
      currentPart.id,
      { text: currentPart.text + textDelta },
    ) as TextPart
  }

  finish(finishReason: NonNullable<TurnContext["assistant"]["finish"]>, structured?: unknown) {
    this.enterPhase("finishing")
    this.ctx.assistant = this.ctx.session_store.updateMessage(this.ctx.sessionID, this.ctx.assistant.id, {
      finish: finishReason,
      ...(structured !== undefined ? { structured } : {}),
      time: { ...this.ctx.assistant.time, completed: Date.now() },
    })

    this.ctx.events.emit({ type: "finish", ...this.base(), finishReason: finishReason ?? "stop" })

    if (structured !== undefined) {
      this.ctx.events.emit({ type: "structured-output", ...this.base(), output: structured })
    }

    this.emitTurnComplete(finishReason ?? "stop")
  }

  fail(error: ErrorInfo) {
    this.enterPhase("finishing")
    this.ctx.assistant = this.ctx.session_store.updateMessage(this.ctx.sessionID, this.ctx.assistant.id, {
      error,
      finish: "error",
      time: { ...this.ctx.assistant.time, completed: Date.now() },
    })

    this.ctx.events.emit({ type: "error", ...this.base(), error: error.message })
    this.emitTurnComplete("error")
  }

  abort() {
    this.enterPhase("finishing")
    this.ctx.assistant = this.ctx.session_store.updateMessage(this.ctx.sessionID, this.ctx.assistant.id, {
      error: { message: "Aborted", retryable: false, code: "aborted" },
      finish: "error",
      time: { ...this.ctx.assistant.time, completed: Date.now() },
    })

    this.ctx.events.emit({ type: "turn-abort", ...this.base(), durationMs: Date.now() - this.ctx.startedAt })
  }

  private emitTurnComplete(finishReason: string) {
    this.ctx.events.emit({
      type: "turn-complete",
      ...this.base(),
      finishReason,
      durationMs: Date.now() - this.ctx.startedAt,
      toolCalls: this.ctx.toolCalls,
    })
  }
}

// Appends a synthetic stop note to the current assistant message (shared by the
// budget middleware / tool guards via the engine).
export function appendStopNote(ctx: TurnContext, note: string) {
  ctx.session_store.appendTextPart(ctx.sessionID, ctx.assistant.id, {
    id: createID(),
    type: "text",
    text: note,
    synthetic: true,
  })
}

import type { RuntimeDeps } from "@harness/runtime/context"
import { SessionCompaction } from "@harness/session/compaction"
import type { ProcessorContext } from "@harness/session/processor-context"
import type { TurnExecutionPolicy } from "@harness/session/execution-policy"
import { hasStructuredOutputFormat, parseStructuredOutputText } from "@harness/session/structured-output"
import {
  createID,
  type AgentInfo,
  type AssistantMessage,
  type ErrorInfo,
  type ProcessorResult,
  type ReasoningPart,
  type TextPart,
  type ToolDefinition,
  type TurnOutcomeReason,
  type TurnPhase,
  type UserMessage,
} from "@harness/types"

const VALID_PHASE_TRANSITIONS: Record<TurnPhase, TurnPhase[]> = {
  starting: ["streaming", "finishing"],
  streaming: ["reasoning", "responding", "executing-tool", "finishing"],
  reasoning: ["streaming", "responding", "executing-tool", "finishing"],
  responding: ["streaming", "executing-tool", "finishing"],
  "executing-tool": ["streaming", "finishing"],
  finishing: [],
}

export class TurnLifecycle {
  constructor(private readonly context: ProcessorContext) {}

  start() {
    this.context.events.emit({
      type: "turn-start",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      step: this.resolveTurnStep(),
    })
  }

  enterPhase(phase: TurnPhase) {
    if (this.context.phase === phase) return
    const allowed = VALID_PHASE_TRANSITIONS[this.context.phase]
    if (!allowed.includes(phase)) {
      throw new Error(`Invalid turn phase transition: ${this.context.phase} -> ${phase}`)
    }

    this.context.phase = phase
    this.context.events.emit({
      type: "turn-phase",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      phase,
    })
  }

  appendReasoning(textDelta: string) {
    if (!this.context.sawReasoning) {
      this.context.sawReasoning = true
      this.enterPhase("reasoning")
    }

    this.context.events.emit({
      type: "reasoning",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      textDelta,
    })

    if (!this.context.reasoningPart) {
      this.context.textPart = undefined
      this.context.reasoningPart = this.context.session_store.appendReasoningPart(this.context.session.id, this.context.assistant.id, {
        id: createID(),
        type: "reasoning",
        text: "",
      })
    }

    const currentPart = this.context.reasoningPart
    if (!currentPart) return

    this.context.reasoningPart = this.context.session_store.updatePart(
      this.context.session.id,
      this.context.assistant.id,
      currentPart.id,
      { text: currentPart.text + textDelta },
    ) as ReasoningPart
  }

  appendText(textDelta: string, options?: { synthetic?: boolean }) {
    if (!this.context.sawText) {
      this.context.sawText = true
      this.enterPhase("responding")
    }

    this.context.events.emit({
      type: "text",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      textDelta,
    })

    this.context.reasoningPart = undefined
    if (!this.context.textPart) {
      this.context.textPart = this.context.session_store.appendTextPart(this.context.session.id, this.context.assistant.id, {
        id: createID(),
        type: "text",
        text: "",
        synthetic: options?.synthetic,
      })
    }

    const currentPart = this.context.textPart
    if (!currentPart) return

    this.context.textPart = this.context.session_store.updatePart(
      this.context.session.id,
      this.context.assistant.id,
      currentPart.id,
      { text: currentPart.text + textDelta },
    ) as TextPart
  }

  finish(finishReason: ProcessorContext["assistant"]["finish"]) {
    const structured = this.resolveStructuredOutput()
    if (structured?.error) {
      this.fail({
        message: structured.error,
        retryable: false,
        code: "invalid_structured_output",
      })
      return
    }

    this.enterPhase("finishing")
    this.context.assistant = this.context.session_store.updateMessage(this.context.session.id, this.context.assistant.id, {
      finish: finishReason,
      ...(structured ? { structured: structured.data } : {}),
      time: {
        ...this.context.assistant.time,
        completed: Date.now(),
      },
    })

    this.context.events.emit({
      type: "finish",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      finishReason: finishReason ?? "stop",
    })

    if (structured) {
      this.context.events.emit({
        type: "structured-output",
        sessionID: this.context.session.id,
        agent: this.context.agent.name,
        messageID: this.context.assistant.parentID,
        turnID: this.context.assistant.id,
        output: structured.data,
      })
    }

    this.emitTurnComplete(finishReason ?? "stop")
  }

  fail(error: ErrorInfo) {
    this.enterPhase("finishing")
    this.context.assistant = this.context.session_store.updateMessage(this.context.session.id, this.context.assistant.id, {
      error,
      finish: "error",
      time: {
        ...this.context.assistant.time,
        completed: Date.now(),
      },
    })

    this.context.events.emit({
      type: "error",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      error: error.message,
    })

    this.emitTurnComplete("error")
  }

  abort() {
    this.enterPhase("finishing")
    this.context.assistant = this.context.session_store.updateMessage(this.context.session.id, this.context.assistant.id, {
      error: {
        message: "Aborted",
        retryable: false,
        code: "aborted",
      },
      finish: "error",
      time: {
        ...this.context.assistant.time,
        completed: Date.now(),
      },
    })

    this.context.events.emit({
      type: "turn-abort",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      durationMs: Date.now() - this.context.startedAt,
    })
  }

  private emitTurnComplete(finishReason: string) {
    this.context.events.emit({
      type: "turn-complete",
      sessionID: this.context.session.id,
      agent: this.context.agent.name,
      messageID: this.context.assistant.parentID,
      turnID: this.context.assistant.id,
      finishReason,
      durationMs: Date.now() - this.context.startedAt,
      toolCalls: this.context.toolCalls,
    })
  }

  private resolveTurnStep() {
    const session = this.context.session_store.get(this.context.session.id)
    return session.messages.filter((message) => message.role === "assistant").length
  }

  private resolveStructuredOutput() {
    if (!hasStructuredOutputFormat(this.context.user.format)) return undefined

    const text = this.context.session_store.getMessageText(this.context.session.id, this.context.assistant.id, {
      includeSynthetic: false,
    })
    return parseStructuredOutputText(text)
  }
}

export type PromptLoopContext = RuntimeDeps & {
  sessionID: string
  abort: AbortSignal
  step: number
}

export type PromptTurnState = {
  user: UserMessage
  agent: AgentInfo
  policy: TurnExecutionPolicy
  tools: ToolDefinition[]
  assistant: AssistantMessage
}

export type TurnOutcome =
  | { kind: "continue"; reason: Extract<TurnOutcomeReason, "tool_calls" | "empty_assistant"> }
  | { kind: "compact"; reason: Extract<TurnOutcomeReason, "context_limit"> }
  | {
      kind: "break"
      reason: Exclude<TurnOutcomeReason, "tool_calls" | "empty_assistant" | "context_limit">
    }

export function resolveTurnOutcome(input: {
  context: PromptLoopContext
  state: PromptTurnState
  result: ProcessorResult
}): TurnOutcome {
  const latestAssistant = input.context.session_store.get(input.context.sessionID).messages.find(
    (message: { id: string }) => message.id === input.state.assistant.id,
  ) as AssistantMessage | undefined
  const hasFinalText = latestAssistant
    ? input.context.session_store.getMessageText(input.context.sessionID, latestAssistant.id, { includeSynthetic: false }).trim().length > 0
    : false

  if (latestAssistant?.structured !== undefined) {
    return { kind: "break", reason: "structured_output" }
  }

  if (input.result === "compact") {
    return { kind: "compact", reason: "context_limit" }
  }

  if (input.result === "continue") {
    const maxSteps = input.state.policy.budget.maxSteps
    if (input.context.step >= maxSteps) {
      return { kind: "break", reason: "step_budget_reached" }
    }
    return { kind: "continue", reason: "tool_calls" }
  }

  if (latestAssistant && !latestAssistant.error && !hasFinalText) {
    const maxSteps = input.state.policy.budget.maxSteps
    if (input.context.step < maxSteps) {
      return { kind: "continue", reason: "empty_assistant" }
    }

    return { kind: "break", reason: "step_budget_reached_without_answer" }
  }

  if (latestAssistant?.error) {
    return { kind: "break", reason: "assistant_error" }
  }

  if (hasFinalText) {
    return { kind: "break", reason: "final_text" }
  }

  return { kind: "break", reason: "completed_without_output" }
}

export function applyTurnOutcome(input: {
  context: PromptLoopContext
  state: PromptTurnState
  outcome: TurnOutcome
}) {
  input.context.events.emit({
    type: "turn-outcome",
    sessionID: input.context.sessionID,
    agent: input.state.agent.name,
    messageID: input.state.assistant.parentID,
    turnID: input.state.assistant.id,
    step: input.context.step,
    outcome: input.outcome.kind,
    reason: input.outcome.reason,
  })

  if (input.outcome.kind === "compact") {
    const session = input.context.session_store.get(input.context.sessionID)
    SessionCompaction.process({
      store: input.context.session_store,
      events: input.context.events,
      session,
      trigger: input.state.assistant,
      latestUser: input.state.user,
    })
    return { kind: "continue" as const }
  }

  if (input.outcome.kind === "continue") {
    return { kind: "continue" as const }
  }

  if (input.outcome.reason === "step_budget_reached") {
    emitStepBudgetHit(input.context, input.state)
    input.context.session_store.updateMessage(input.context.sessionID, input.state.assistant.id, { finish: "stop" })
    input.context.session_store.appendTextPart(input.context.sessionID, input.state.assistant.id, {
      id: createID(),
      type: "text",
      text: `\n\n[Stopped: ${resolveStepBudgetStopReason(input.state.policy)}]`,
      synthetic: true,
    })
  }

  if (input.outcome.reason === "step_budget_reached_without_answer") {
    emitStepBudgetHit(input.context, input.state)
    input.context.session_store.updateMessage(input.context.sessionID, input.state.assistant.id, { finish: "stop" })
    input.context.session_store.appendTextPart(input.context.sessionID, input.state.assistant.id, {
      id: createID(),
      type: "text",
      text: `\n\n[Stopped: model ended without a final answer before ${resolveStepBudgetStopReason(input.state.policy)}]`,
      synthetic: true,
    })
  }

  return { kind: "break" as const }
}

function emitStepBudgetHit(context: PromptLoopContext, state: PromptTurnState) {
  const budget = resolveStepBudgetEvent(state.policy)
  context.events.emit({
    type: "budget-hit",
    sessionID: context.sessionID,
    agent: state.agent.name,
    budget: budget.kind,
    detail: budget.detail,
    limit: budget.limit,
    used: budget.used,
  })
}

function resolveStepBudgetEvent(policy: TurnExecutionPolicy) {
  if (policy.budget.sessionStepsRemaining <= policy.budget.maxAgentSteps) {
    return {
      kind: "session_steps" as const,
      detail: "Total session step budget reached",
      limit: policy.budget.maxSessionSteps,
      used: policy.budget.sessionStepsUsed + policy.budget.maxSteps,
    }
  }

  return {
    kind: "agent_steps" as const,
    detail: "Agent step budget reached for this prompt loop",
    limit: policy.budget.maxAgentSteps,
    used: policy.budget.maxSteps,
  }
}

function resolveStepBudgetStopReason(policy: TurnExecutionPolicy) {
  if (policy.budget.sessionStepsRemaining <= policy.budget.maxAgentSteps) {
    return "total session step budget reached"
  }

  return "max steps reached"
}

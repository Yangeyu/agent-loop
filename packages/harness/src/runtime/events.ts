import type { ErrorInfo, ToolAttachment, ToolMetadata, TurnOutcomeReason, TurnPhase } from "@harness/types"

type TurnScopedEvent = {
  sessionID: string
  agent: string
  messageID: string
  turnID: string
}

type RuntimeEvent =
  | { type: "session-start"; sessionID: string; agent: string; text: string }
  | { type: "loop-step"; sessionID: string; step: number; agent: string }
  | (TurnScopedEvent & {
      type: "turn-input"
      step: number
      system: string[]
      tools: string[]
      messageCount: number
    })
  | {
      type: "budget-hit"
      sessionID: string
      agent: string
      budget: "session_steps" | "agent_steps" | "subagent_depth" | "tool_calls" | "tool_failures"
      detail: string
      limit: number
      used?: number
    }
  | (TurnScopedEvent & { type: "turn-start"; step: number })
  | (TurnScopedEvent & {
      type: "retry"
      attempt: number
      delayMs: number
      category: "abort" | "timeout" | "network" | "availability" | "rate_limit" | "unknown"
      reason?: string
      error: string
    })
  | (TurnScopedEvent & {
      type: "turn-phase"
      phase: TurnPhase
    })
  | (TurnScopedEvent & { type: "reasoning"; textDelta: string })
  | (TurnScopedEvent & { type: "text"; textDelta: string })
  | (TurnScopedEvent & { type: "tool-call"; tool: string; toolCallId: string; args: unknown })
  | (TurnScopedEvent & { type: "tool-start"; tool: string; toolCallId: string })
  | (TurnScopedEvent & {
      type: "tool-metadata"
      tool: string
      toolCallId: string
      title?: string
      metadata?: ToolMetadata
    })
  | (TurnScopedEvent & {
      type: "tool-result"
      tool: string
      toolCallId: string
      output: string
      title?: string
      metadata?: ToolMetadata
      attachments?: ToolAttachment[]
    })
  | (TurnScopedEvent & {
      type: "tool-error"
      tool: string
      toolCallId: string
      error: string
      errorInfo?: ErrorInfo
    })
  | (TurnScopedEvent & { type: "structured-output"; output: unknown })
  | { type: "compaction"; sessionID: string; summary: string }
  | (TurnScopedEvent & { type: "finish"; finishReason: string })
  | (TurnScopedEvent & {
      type: "turn-outcome"
      step: number
      outcome: "continue" | "compact" | "break"
      reason: TurnOutcomeReason
    })
  | (TurnScopedEvent & {
      type: "turn-complete"
      finishReason: string
      durationMs: number
      toolCalls: number
    })
  | (TurnScopedEvent & { type: "turn-abort"; durationMs: number })
  | (TurnScopedEvent & { type: "error"; error: string })

type Listener = (event: RuntimeEvent) => void

export type RuntimeEventBus = {
  emit(event: RuntimeEvent): void
  subscribe(listener: Listener): () => void
}

export function createRuntimeEvents(): RuntimeEventBus {
  const listeners = new Set<Listener>()

  return {
    emit(event) {
      for (const listener of listeners) listener(event)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type { Listener, RuntimeEvent }

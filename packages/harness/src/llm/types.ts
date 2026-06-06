// Core LLM protocol types shared across the runtime and providers.
import type { AgentInfo, AssistantMessage, SessionInfo, ToolDefinition, UserMessage } from "@harness/types"

export type ModelContentBlock =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "reasoning"; text: string }
  | { type: "structured-output"; data: unknown }
  | { type: "tool-output"; output: string; title?: string; metadata?: unknown }
  | { type: "tool-error"; toolName: string; input: unknown; error: string }
  | { type: "context-summary"; text: string }
  | { type: "error"; text: string }

export type ModelCapabilities = {
  tools: boolean
  reasoning: boolean
  structuredOutput: boolean
  streaming: boolean
}

export type ModelDefaults = {
  modelID: string
  temperature: number
}

export type ModelSpec = {
  id: "fake" | "qwen"
  provider: "local" | "qwen-compatible"
  capabilities: ModelCapabilities
  defaults: ModelDefaults
}

export type ModelRuntime = {
  spec: ModelSpec
  streamText(input: LLMInput): LLMStreamResult
}

export type ModelMessage = {
  role: "system" | "user" | "assistant"
  content: ModelContentBlock[]
} | {
  role: "tool"
  toolCallId: string
  toolName: string
  input: unknown
  content: ModelContentBlock[]
}

export type LLMInput = {
  session: SessionInfo
  user: UserMessage
  assistant: AssistantMessage
  agent: AgentInfo
  system: string[]
  messages: ModelMessage[]
  tools: ToolDefinition[]
  abort: AbortSignal
}

export type LLMChunk =
  | { type: "text-delta"; textDelta: string }
  | { type: "reasoning"; textDelta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "finish"; finishReason: string }
  | { type: "error"; error: unknown }

export type LLMStreamResult = {
  fullStream: AsyncIterable<LLMChunk>
}

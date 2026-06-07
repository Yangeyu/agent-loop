/** Core LLM protocol types shared across the runtime and providers. */
import type { AgentInfo, AssistantMessage, ImageSource, SessionInfo, ToolDefinition, UserMessage } from "@harness/types"

export const DEFAULT_TEMPERATURE = 0.2

/** A single block of model message content (text, reasoning, tool I/O, image …). */
export type ModelContentBlock =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "reasoning"; text: string }
  | { type: "structured-output"; data: unknown }
  | { type: "tool-output"; output: string; title?: string; metadata?: unknown }
  | { type: "tool-error"; toolName: string; input: unknown; error: string }
  | { type: "context-summary"; text: string }
  | { type: "image"; source: ImageSource }
  | { type: "error"; text: string }

/** What a model can do; middleware gate behavior on these flags. */
export type ModelCapabilities = {
  tools: boolean
  reasoning: boolean
  structuredOutput: boolean
  streaming: boolean
  // Whether the model accepts image content blocks (multimodal vision input).
  vision: boolean
}

/**
 * A single model served by a provider. Capabilities + context window are
 * per-model (qwen3.7-plus is multimodal; qwen3.6-flash is a cheaper text model).
 */
export type ProviderModelSpec = {
  id: string
  capabilities: ModelCapabilities
  // Maximum context window (tokens). Drives proactive compaction's trigger
  // threshold (contextWindow × compaction_trigger_ratio).
  contextWindow: number
}

/**
 * A model provider implementation — the unit the registry holds and routes to.
 * Each provider (DashScope, OpenAI, DeepSeek …) is created by its own module
 * (e.g. providers/dashscope.ts), which owns how it builds its LLM. Modules that
 * target an OpenAI-compatible endpoint build on the shared compat factory
 * (providers/openai-compat.ts); a provider that needs a wholly different
 * transport can implement this contract directly.
 */
export type Provider = {
  /** Stable provider id used for registry lookup and `model.providerID` routing. */
  id: string
  /** The models this provider serves; read for capabilities/context window. */
  models: ProviderModelSpec[]
  /** The model used when a request does not name one. */
  defaultModelID: string
  /**
   * Issues one streaming request for the given input against the already-resolved
   * model. Model selection is the entrypoint's job (see streamText); the provider
   * receives the concrete model and only sends — it never re-resolves.
   */
  stream(input: LLMInput, model: ProviderModelSpec): LLMStreamResult
}

/** A tool call the assistant issued in a turn (the request half of a call). */
export type ModelToolCall = {
  id: string
  name: string
  input: unknown
}

/**
 * A single message in provider-neutral form. The assistant message owns the tool
 * calls it issued (`toolCalls`); each `tool` message carries only the result,
 * linked back by `toolCallId`. This mirrors the wire protocol's shape, so a
 * provider maps the list 1:1 without re-grouping calls and results.
 */
export type ModelMessage =
  | {
      role: "system" | "user"
      content: ModelContentBlock[]
    }
  | {
      role: "assistant"
      content: ModelContentBlock[]
      toolCalls?: ModelToolCall[]
    }
  | {
      role: "tool"
      toolCallId: string
      content: ModelContentBlock[]
    }

/** The fully assembled input for one model turn, handed to a provider's stream(). */
export type LLMInput = {
  session: SessionInfo
  user: UserMessage
  assistant: AssistantMessage
  agent: AgentInfo
  temperature?: number
  system: string[]
  messages: ModelMessage[]
  tools: ToolDefinition[]
  abort: AbortSignal
}

/** One decoded event off the model stream. */
export type LLMChunk =
  | { type: "text-delta"; textDelta: string }
  | { type: "reasoning"; textDelta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "finish"; finishReason: string }
  | { type: "error"; error: unknown }

/** A provider's streaming response: an async iterable of decoded chunks. */
export type LLMStreamResult = {
  fullStream: AsyncIterable<LLMChunk>
}

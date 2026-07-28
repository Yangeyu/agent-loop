/** Core LLM protocol types shared across the runtime and providers. */
import type { ImageSource, ToolDefinition } from "@agent-core/types"

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
  // Whether the model can emit several tool calls in one turn. When true the
  // provider requests parallel calls; the engine then dispatches them concurrently.
  // Many OpenAI-compatible endpoints (DashScope included) default this off, so it
  // must be opted in per model.
  parallelToolCalls: boolean
}

/**
 * A single model served by a provider. Capabilities + context window are
 * per-model (qwen3.7-plus is multimodal; qwen3.6-flash is a cheaper text model).
 */
export type ProviderModelSpec = {
  id: string
  capabilities: ModelCapabilities
  /** Maximum context window (tokens); drives proactive compaction's trigger threshold. */
  contextWindow: number
}

/**
 * A ready-to-use model instance — provider, connection, and target model all
 * bound at construction time. This is the unit an agent holds
 * (AgentDefinition.model). Each provider module builds its own via its
 * createXxxModel factory; modules targeting an OpenAI-compatible endpoint
 * build on the shared compat factory (providers/openai-compat.ts).
 */
export type Model = {
  /** Provider id this instance speaks to (e.g. "dashscope"); display/metadata only. */
  readonly providerID: string
  /** The bound model's spec — capabilities + context window, read by gating middleware. */
  readonly spec: ProviderModelSpec
  /** Issues one streaming request against the bound model; never re-resolves. */
  stream(input: LLMInput): LLMStreamResult
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

/**
 * The fully assembled input for one model turn, handed to a Model's stream().
 * Holds exactly what the transport sends — the conversation is already projected
 * to system + messages upstream (see llm/message.ts), so no session/agent context
 * leaks into the wire layer.
 */
export type LLMInput = {
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

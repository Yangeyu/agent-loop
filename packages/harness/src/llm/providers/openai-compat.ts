/**
 * The reusable compatibility base for any provider that speaks the
 * OpenAI-compatible Chat Completions protocol. It owns only transport-level
 * concerns — request building, the 1:1 ModelMessage -> OpenAI message mapping,
 * and stream decoding. The conversation is already fully modeled upstream (see
 * llm/message.ts): the assistant message carries its tool calls and each tool
 * message its result, so this module maps the list straight through without
 * re-grouping. A provider module (e.g. providers/dashscope.ts) builds its own
 * createXxxModel factory on top by calling createOpenAICompatModel with a
 * resolved connection (baseURL/apiKey) and the target model spec; vendor
 * differences enter solely through the config hooks (extraBody for request
 * extras, readReasoning for non-standard streaming fields). This module knows
 * nothing about any specific vendor.
 */
import OpenAI from "openai"
import { DEFAULT_TEMPERATURE, type LLMChunk, type LLMInput, type Model, type ModelContentBlock, type ModelMessage, type ProviderModelSpec } from "@harness/llm/types"
import { imageSourceToUrl } from "@harness/llm/image"
import { serializeContentBlocks } from "@harness/llm/message"
import { createID, ToolDefinition } from "@harness/types"
import { zodToJsonSchema } from "zod-to-json-schema"

/**
 * What a provider's createXxxModel factory hands the compat base to build one
 * bound Model: the resolved connection (provider id, endpoint, key), the target
 * model spec, an optional default temperature, and two optional hooks for the
 * vendor's non-standard bits. Key resolution (env fallbacks, etc.) is the
 * provider factory's job — this base receives a concrete connection.
 */
export type OpenAICompatModelConfig = {
  providerID: string
  baseURL: string
  apiKey: string
  model: ProviderModelSpec
  temperature?: number
  // Vendor-specific request body additions (e.g. DashScope's enable_thinking).
  extraBody?(model: ProviderModelSpec): Record<string, unknown>
  // Vendor-specific reasoning extraction from a streaming delta (e.g. DashScope /
  // DeepSeek expose chain-of-thought via delta.reasoning_content). Returns the
  // reasoning text delta, or undefined when the provider has none.
  readReasoning?(delta: unknown): string | undefined
}

// Content is either a flattened tagged string (text-only messages, the common
// case) or an OpenAI-style multimodal array when image blocks are present.
type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }

type OpenAIRequestMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | OpenAIContentPart[]
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
}

type AccumulatedToolCall = {
  id: string
  name: string
  argumentsText: string
}

/**
 * Builds one bound Model for an OpenAI-compatible endpoint: an OpenAI SDK client
 * pointed at the config's baseURL/apiKey, lazily created and reused across turns.
 * This is the shared base — a provider's createXxxModel factory (e.g.
 * createDashScopeModel) calls it with a resolved connection and target spec.
 *
 * @param config - the resolved connection, target model spec, and quirk hooks
 * @returns a Model whose stream() issues one Chat Completions request per call
 */
export function createOpenAICompatModel(config: OpenAICompatModelConfig): Model {
  let client: OpenAI | undefined
  // The SDK client is a thin config holder; build it on first use (so a missing
  // key only surfaces when the model is actually invoked) and reuse it.
  const getClient = () => {
    if (!config.apiKey) throw new Error(`Missing API key for provider "${config.providerID}".`)
    return (client ??= new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL }))
  }
  return {
    providerID: config.providerID,
    spec: config.model,
    stream: (input) => ({ fullStream: runStream(config, getClient, input) }),
  }
}

async function* runStream(
  config: OpenAICompatModelConfig,
  getClient: () => OpenAI,
  input: LLMInput,
): AsyncGenerator<LLMChunk> {
  const model = config.model
  const toolCalls = new Map<number, AccumulatedToolCall>()
  let finishReason = "stop"

  try {
    const client = getClient()
    const tools = buildTools(input.tools)
    const stream = await client.chat.completions.create(
      {
        model: model.id,
        messages: buildMessages(input),
        ...(tools.length > 0
          ? { tools, tool_choice: "auto" as const, parallel_tool_calls: model.capabilities.parallelToolCalls }
          : {}),
        temperature: input.temperature ?? config.temperature ?? DEFAULT_TEMPERATURE,
        stream: true,
        stream_options: { include_usage: true },
        ...(config.extraBody?.(model) ?? {}),
      } as Parameters<typeof client.chat.completions.create>[0],
      { signal: input.abort },
    )

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      const choice = chunk.choices?.[0]
      const delta = choice?.delta
      if (!delta) continue

      const reasoning = config.readReasoning?.(delta)
      if (reasoning) yield { type: "reasoning", textDelta: reasoning }
      if (delta.content) yield { type: "text-delta", textDelta: delta.content }
      for (const toolCall of delta.tool_calls ?? []) accumulateToolCall(toolCalls, toolCall)
      if (choice.finish_reason) finishReason = mapFinishReason(choice.finish_reason)
    }
  } catch (error) {
    yield { type: "error", error }
    return
  }

  for (const toolCall of toolCalls.values()) {
    yield {
      type: "tool-call",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: parseToolArgs(toolCall.argumentsText),
    }
  }
  yield { type: "finish", finishReason }
}

function buildMessages(input: LLMInput): OpenAIRequestMessage[] {
  return [
    ...input.system.filter(Boolean).map((content) => ({ role: "system" as const, content })),
    ...mapMessages(input.messages),
  ]
}

/**
 * Maps the neutral ModelMessage list to OpenAI request messages, one to one. The
 * assistant message's tool calls become its `tool_calls`; each tool message its
 * result. No re-grouping happens — the upstream model already placed calls and
 * results in protocol order. Exported for testing.
 *
 * @param messages - the provider-neutral model messages, in conversation order
 * @returns the OpenAI request messages, in the same order
 */
export function mapMessages(messages: ModelMessage[]): OpenAIRequestMessage[] {
  return messages.map(mapModelMessage)
}

function mapModelMessage(message: ModelMessage): OpenAIRequestMessage {
  if (message.role === "tool") {
    return { role: "tool", content: serializeContentBlocks(message.content), tool_call_id: message.toolCallId }
  }

  if (message.role === "assistant") {
    const toolCalls = message.toolCalls ?? []
    return {
      role: "assistant",
      content: buildMessageContent(message.content),
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: serializeToolInput(call.input) },
            })),
          }
        : {}),
    }
  }

  return { role: message.role, content: buildMessageContent(message.content) }
}

/**
 * Maps a message's content blocks to an OpenAI message `content`. Text-only
 * content stays a single tagged string (the common case); when any image block is
 * present it switches to the multimodal array form — one text part for all
 * non-image blocks plus one `image_url` part per image. Exported for testing.
 *
 * @param blocks - the model content blocks of a single user/assistant message
 * @returns a tagged string, or an OpenAI content-part array when images are present
 */
export function buildMessageContent(blocks: ModelContentBlock[]): string | OpenAIContentPart[] {
  const images = blocks.filter((block): block is Extract<ModelContentBlock, { type: "image" }> => block.type === "image")
  if (images.length === 0) return serializeContentBlocks(blocks)

  const parts: OpenAIContentPart[] = []
  const text = serializeContentBlocks(blocks.filter((block) => block.type !== "image"))
  if (text) parts.push({ type: "text", text })
  for (const image of images) parts.push({ type: "image_url", image_url: { url: imageSourceToUrl(image.source) } })
  return parts
}

function buildTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.id,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters, { $refStrategy: "none" }),
    },
  }))
}

function accumulateToolCall(
  toolCalls: Map<number, AccumulatedToolCall>,
  toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall,
) {
  const index = toolCall.index ?? 0
  const current = toolCalls.get(index) ?? { id: toolCall.id ?? createID(), name: "", argumentsText: "" }

  if (toolCall.id) current.id = toolCall.id
  if (toolCall.function?.name) current.name = toolCall.function.name
  if (toolCall.function?.arguments) current.argumentsText += toolCall.function.arguments

  toolCalls.set(index, current)
}

function serializeToolInput(input: unknown): string {
  if (typeof input === "string") return input
  return JSON.stringify(input ?? {})
}

function parseToolArgs(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}

function mapFinishReason(reason: string): string {
  if (reason === "tool_calls" || reason === "tool-calls") return "tool-calls"
  if (reason === "length") return "length"
  if (reason === "error") return "error"
  return "stop"
}

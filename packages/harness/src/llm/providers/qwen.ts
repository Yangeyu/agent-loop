// Qwen provider adapter: request building, content mapping, and stream decoding.
import { resolveModelSpec } from "@harness/llm/models"
import { createStreamingProvider } from "@harness/llm/providers/create"
import type { ProviderRequest } from "@harness/llm/providers/create"
import type { LLMChunk, LLMInput, ModelContentBlock, ModelMessage } from "@harness/llm/types"
import { createID, ToolDefinition } from "@harness/types"
import { zodToJsonSchema } from "zod-to-json-schema"

type QwenToolDefinition = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

type QwenDeltaToolCall = {
  index?: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

type QwenChoiceDelta = {
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: QwenDeltaToolCall[]
}

type QwenChoice = {
  finish_reason?: string | null
  delta?: QwenChoiceDelta
}

type QwenSSEPayload = {
  choices?: QwenChoice[]
  error?: { message?: string }
}

type QwenAccumulatedToolCall = {
  id: string
  name: string
  argumentsText: string
}

type QwenRequestMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: "function"
    function: {
      name: string
      arguments: string
    }
  }>
}

type QwenContentItem =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "structured-output"; value: string }
  | { type: "context-summary"; text: string }
  | { type: "tool-result"; title?: string; metadata?: string; output: string }
  | { type: "error"; text: string }

type QwenContentPayload = {
  items: QwenContentItem[]
}

type QwenRequestBody = {
  model: string
  messages: QwenRequestMessage[]
  tools?: QwenToolDefinition[]
  tool_choice?: "required" | "auto"
  temperature: number
  stream: true
  stream_options: {
    include_usage: true
  }
  enable_thinking: boolean
}

type QwenResponseState = {
  toolCalls: Map<number, QwenAccumulatedToolCall>
  finishReason: string
}

export const qwenStream = createStreamingProvider({
  name: "Qwen",
  buildRequest: buildQwenRequest,
  createState: createQwenResponseState,
  parsePayload: decodeQwenPayload,
  mapPayload: mapQwenPayloadToChunks,
  flush: flushQwenChunks,
})

function buildQwenRequest(input: LLMInput): ProviderRequest<QwenRequestBody> {
  const model = resolveModelSpec()
  const tools = buildQwenTools(input.tools)

  return {
    url: `${getBaseURL()}/chat/completions`,
    apiKey: resolveApiKey(),
    body: {
      model: input.user.model.modelID || model.defaults.modelID,
      messages: buildQwenMessages(input),
      ...(tools.length > 0
        ? {
            tools,
            tool_choice: "auto" as const,
          }
        : {}),
      temperature: model.defaults.temperature,
      stream: true,
      stream_options: {
        include_usage: true,
      },
      enable_thinking: model.capabilities.reasoning,
    },
  }
}

function buildQwenMessages(input: LLMInput): QwenRequestMessage[] {
  const messages: QwenRequestMessage[] = [
    ...input.system.filter(Boolean).map((content) => ({ role: "system" as const, content })),
  ]

  for (const message of input.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: message.toolCallId,
            type: "function",
            function: {
              name: message.toolName,
              arguments: serializeToolInput(message.input),
            },
          },
        ],
      })
      messages.push(mapModelMessageToQwen(message))
      continue
    }

    messages.push(mapModelMessageToQwen(message))
  }

  return messages
}

function mapModelMessageToQwen(message: ModelMessage): QwenRequestMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: serializeQwenContent(message.content),
      tool_call_id: message.toolCallId,
    }
  }

  return {
    role: message.role,
    content: serializeQwenContent(message.content),
  }
}

function serializeQwenContent(blocks: ModelMessage["content"]) {
  return renderQwenContent(buildQwenContentPayload(blocks))
}

function buildQwenContentPayload(parts: ModelContentBlock[]): QwenContentPayload {
  return {
    items: parts.map((part) => mapQwenContentItem(part)),
  }
}

function mapQwenContentItem(part: ModelContentBlock): QwenContentItem {
  if (part.type === "text") return { type: "text", text: part.text }
  if (part.type === "reasoning") return { type: "reasoning", text: part.text }
  if (part.type === "structured-output") {
    return {
      type: "structured-output",
      value: typeof part.data === "string" ? part.data : JSON.stringify(part.data),
    }
  }
  if (part.type === "context-summary") return { type: "context-summary", text: part.text }
  if (part.type === "tool-output") {
    return {
      type: "tool-result",
      title: part.title,
      metadata: part.metadata !== undefined ? serializeUnknown(part.metadata) : undefined,
      output: part.output,
    }
  }
  if (part.type === "tool-error") {
    return {
      type: "error",
      text: [
        "<tool-error>",
        `<tool>${part.toolName}</tool>`,
        `<input>${serializeUnknown(part.input)}</input>`,
        `<error>${part.error}</error>`,
        "</tool-error>",
      ].join("\n"),
    }
  }
  return { type: "error", text: part.text }
}

function renderQwenContent(payload: QwenContentPayload) {
  return payload.items.map((item) => renderQwenContentItem(item)).filter(Boolean).join("\n\n")
}

function renderQwenContentItem(item: QwenContentItem) {
  if (item.type === "text") return item.text
  if (item.type === "reasoning") return ["<reasoning>", item.text, "</reasoning>"].join("\n")
  if (item.type === "structured-output") {
    return ["<structured-output>", item.value, "</structured-output>"].join("\n")
  }
  if (item.type === "context-summary") {
    return ["<context-summary>", item.text, "</context-summary>"].join("\n")
  }
  if (item.type === "tool-result") {
    return [
      item.title ? ["<title>", item.title, "</title>"].join("\n") : "",
      item.metadata !== undefined ? ["<metadata>", item.metadata, "</metadata>"].join("\n") : "",
      ["<output>", item.output, "</output>"].join("\n"),
    ]
      .filter(Boolean)
      .join("\n")
  }
  return `error: ${item.text}`
}

function buildQwenTools(tools: ToolDefinition[]): QwenToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.id,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters, { $refStrategy: "none" }),
    },
  }))
}

function createQwenResponseState(): QwenResponseState {
  return {
    toolCalls: new Map<number, QwenAccumulatedToolCall>(),
    finishReason: "stop",
  }
}

function decodeQwenPayload(rawPayload: string): QwenSSEPayload {
  return JSON.parse(rawPayload) as QwenSSEPayload
}

function mapQwenPayloadToChunks(payload: QwenSSEPayload, state: QwenResponseState): LLMChunk[] {
  if (payload.error?.message) {
    return [{ type: "error", error: payload.error.message }]
  }

  const choice = payload.choices?.[0]
  const delta = choice?.delta
  if (!choice || !delta) return []

  const chunks: LLMChunk[] = []

  if (delta.reasoning_content) {
    chunks.push({ type: "reasoning", textDelta: delta.reasoning_content })
  }

  if (delta.content) {
    chunks.push({ type: "text-delta", textDelta: delta.content })
  }

  for (const toolCall of delta.tool_calls ?? []) {
    accumulateToolCall(state.toolCalls, toolCall)
  }

  if (choice.finish_reason) {
    state.finishReason = mapFinishReason(choice.finish_reason)
  }

  return chunks
}

function flushQwenChunks(state: QwenResponseState): LLMChunk[] {
  return [
    ...[...state.toolCalls.values()].map((toolCall) => ({
      type: "tool-call" as const,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: parseToolArgs(toolCall.argumentsText),
    })),
    { type: "finish" as const, finishReason: state.finishReason },
  ]
}

function accumulateToolCall(toolCalls: Map<number, QwenAccumulatedToolCall>, toolCall: QwenDeltaToolCall) {
  const index = toolCall.index ?? 0
  const current = toolCalls.get(index) ?? {
    id: toolCall.id ?? createID(),
    name: "",
    argumentsText: "",
  }

  if (toolCall.id) current.id = toolCall.id
  if (toolCall.function?.name) current.name = toolCall.function.name
  if (toolCall.function?.arguments) current.argumentsText += toolCall.function.arguments

  toolCalls.set(index, current)
}

function serializeToolInput(input: unknown) {
  if (typeof input === "string") return input
  return JSON.stringify(input ?? {})
}

function serializeUnknown(value: unknown) {
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function parseToolArgs(raw: string) {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { raw }
  }
}

function mapFinishReason(reason: string) {
  if (reason === "tool_calls" || reason === "tool-calls") return "tool-calls"
  if (reason === "length") return "length"
  if (reason === "error") return "error"
  return "stop"
}

function resolveApiKey() {
  const apiKey = process.env.DASHSCOPE_API_KEY ?? process.env.QWEN_API_KEY
  if (!apiKey) {
    throw new Error("Missing Qwen API key. Set DASHSCOPE_API_KEY or QWEN_API_KEY.")
  }

  return apiKey
}

function getBaseURL() {
  return process.env.QWEN_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
}

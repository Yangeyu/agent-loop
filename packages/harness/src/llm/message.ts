/**
 * The message-modeling layer. This is the single home for "what a model turn
 * looks like": it projects stored session state into the provider-neutral
 * ModelMessage list, and renders content blocks to their canonical text form.
 *
 * The projection resolves every structural decision here — an assistant turn's
 * text/reasoning, the tool calls it issued, and each call's result — so a
 * provider downstream maps the list 1:1 and only handles transport. Tool calls
 * live on the assistant message (`toolCalls`); each tool result is its own
 * message linked by `toolCallId`. A compaction part renders as a
 * `context-summary` system message before its owner, so a compacted history
 * reads as a summary followed by the retained tail.
 */
import type { ModelContentBlock, ModelMessage, ModelToolCall } from "@harness/llm/types"
import type { AssistantMessage, CompactionPart, ImagePart, MessagePart, SessionInfo, TextPart, ToolPart } from "@harness/types"

/**
 * Projects a session into the ordered ModelMessage list for an LLM turn.
 *
 * @param session - the stored session (messages + parts keyed by message id)
 * @returns the model messages, in conversation order
 */
export function toModelMessages(session: SessionInfo): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (let index = 0; index < session.messages.length; index += 1) {
    const message = session.messages[index]
    const parts = session.parts[message.id] || []

    if (message.role === "user") {
      messages.push(...buildCompactionMessages(parts))
      const userMessage = buildUserMessage(parts, index)
      if (userMessage) messages.push(userMessage)
      continue
    }

    messages.push(...buildAssistantMessages(message, parts))
  }

  return messages
}

function buildUserMessage(parts: readonly MessagePart[], index: number): ModelMessage | undefined {
  const textParts = parts.filter((part): part is TextPart => part.type === "text")
  const content: ModelContentBlock[] = []

  if (index > 0) {
    content.push({
      type: "text",
      text: "Continue the current task using the latest user message below.",
      synthetic: true,
    })
  }

  content.push(...textParts.map((part) => ({ type: "text" as const, text: part.text, synthetic: part.synthetic })))

  const imageParts = parts.filter((part): part is ImagePart => part.type === "image")
  content.push(...imageParts.map((part) => ({ type: "image" as const, source: part.source })))

  if (content.length === 0) return undefined

  return {
    role: "user",
    content,
  }
}

function buildCompactionMessages(parts: readonly MessagePart[]): ModelMessage[] {
  return parts
    .filter((part): part is CompactionPart => part.type === "compaction")
    .map((part) => ({
      role: "system" as const,
      content: [{ type: "context-summary" as const, text: part.summary.trim() }],
    }))
    .filter((message) => message.content[0]?.type === "context-summary" && message.content[0].text)
}

function buildAssistantMessages(message: AssistantMessage, parts: readonly MessagePart[]): ModelMessage[] {
  const results: ModelMessage[] = []
  const content = buildAssistantContent(message, parts)

  // Only replay calls that have a resolved result, so every tool call on the
  // assistant message has a matching tool result message (the wire protocol
  // rejects a dangling call). An unresolved call (still running) means a partial
  // turn that should not be projected into an LLM request.
  const resolved = parts.filter(
    (part): part is ToolPart => part.type === "tool" && (part.state.status === "completed" || part.state.status === "error"),
  )
  const toolCalls: ModelToolCall[] = resolved.map((part) => ({
    id: part.toolCallId,
    name: part.toolName,
    input: part.state.input,
  }))

  if (content.length > 0 || toolCalls.length > 0) {
    results.push({ role: "assistant", content, ...(toolCalls.length > 0 ? { toolCalls } : {}) })
  }

  for (const part of resolved) {
    const toolMessage = toToolResultMessage(part)
    if (toolMessage) results.push(toolMessage)
  }

  return results
}

function buildAssistantContent(message: AssistantMessage, parts: readonly MessagePart[]): ModelContentBlock[] {
  const content: ModelContentBlock[] = []

  for (const part of parts) {
    if (part.type === "text" && part.text) {
      content.push({ type: "text", text: part.text, synthetic: part.synthetic })
      continue
    }

    if (part.type === "reasoning" && part.text.trim()) {
      content.push({ type: "reasoning", text: part.text.trim() })
    }
  }

  if (message.structured !== undefined) {
    content.push({ type: "structured-output", data: message.structured })
  }

  if (message.error) {
    content.push({ type: "error", text: message.error.message })
  }

  return content
}

function toToolResultMessage(part: ToolPart): ModelMessage | undefined {
  if (part.state.status === "completed") {
    return {
      role: "tool",
      toolCallId: part.toolCallId,
      content: [
        {
          type: "tool-output",
          // The model gets the same facts the transcript shows, serialized its
          // way — one flat line. UI layout (truncation, columns) stays out of
          // here; this is the prompt, not a viewport.
          title: [part.state.display.verb, part.state.display.target].filter(Boolean).join(" "),
          output: part.state.output,
          metadata: part.state.metadata,
        },
      ],
    }
  }

  if (part.state.status !== "error") return undefined

  return {
    role: "tool",
    toolCallId: part.toolCallId,
    content: [
      {
        type: "tool-error",
        toolName: part.toolName,
        input: part.state.input,
        error: part.state.error.message,
      },
    ],
  }
}

/**
 * Renders content blocks to the canonical text form a text-chat model consumes:
 * each block becomes a tagged string and blocks join on blank lines. This is the
 * neutral representation shared by every text-completion provider; a provider
 * with native rich-content blocks would render differently. Image blocks never
 * reach here — they carry binary data a provider maps to its own attachment form
 * (e.g. OpenAI's `image_url`), so reaching one here is a projection bug.
 *
 * @param blocks - the content blocks of a single message
 * @returns the blocks rendered as a single tagged string
 */
export function serializeContentBlocks(blocks: ModelContentBlock[]): string {
  return blocks.map((block) => renderContentBlock(block)).filter(Boolean).join("\n\n")
}

function renderContentBlock(block: ModelContentBlock): string {
  if (block.type === "text") return block.text
  if (block.type === "reasoning") return ["<reasoning>", block.text, "</reasoning>"].join("\n")
  if (block.type === "structured-output") {
    const value = typeof block.data === "string" ? block.data : JSON.stringify(block.data)
    return ["<structured-output>", value, "</structured-output>"].join("\n")
  }
  if (block.type === "context-summary") return ["<context-summary>", block.text, "</context-summary>"].join("\n")
  if (block.type === "image") {
    throw new Error("image content blocks carry binary data and must be mapped by the provider, not serialized as text")
  }
  if (block.type === "tool-output") {
    return [
      block.title ? ["<title>", block.title, "</title>"].join("\n") : "",
      block.metadata !== undefined ? ["<metadata>", serializeUnknown(block.metadata), "</metadata>"].join("\n") : "",
      ["<output>", block.output, "</output>"].join("\n"),
    ]
      .filter(Boolean)
      .join("\n")
  }
  if (block.type === "tool-error") {
    return [
      "<tool-error>",
      `<tool>${block.toolName}</tool>`,
      `<input>${serializeUnknown(block.input)}</input>`,
      `<error>${block.error}</error>`,
      "</tool-error>",
    ].join("\n")
  }
  return `error: ${block.text}`
}

function serializeUnknown(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

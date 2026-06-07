/**
 * Projects a stored SessionInfo (messages + their parts) into the provider-neutral
 * ModelMessage list the LLM input carries. Each user/assistant message's parts are
 * folded into content blocks; tool parts become trailing tool-result messages; and
 * a compaction part renders as a `context-summary` system message before its owner,
 * so a compacted history reads as a summary followed by the retained tail.
 */
import type { ModelContentBlock, ModelMessage } from "@harness/llm/types"
import type { AssistantMessage, CompactionPart, ImagePart, MessagePart, SessionInfo, TextPart, ToolPart, UserMessage } from "@harness/types"

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
      const userMessage = buildUserMessage(message, parts, index)
      if (userMessage) messages.push(userMessage)
      continue
    }

    messages.push(...buildAssistantMessages(message, parts))
  }

  return messages
}

function buildUserMessage(message: UserMessage, parts: MessagePart[], index: number): ModelMessage | undefined {
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

function buildCompactionMessages(parts: MessagePart[]): ModelMessage[] {
  return parts
    .filter((part): part is CompactionPart => part.type === "compaction")
    .map((part) => ({
      role: "system" as const,
      content: [{ type: "context-summary" as const, text: part.summary.trim() }],
    }))
    .filter((message) => message.content[0]?.type === "context-summary" && message.content[0].text)
}

function buildAssistantMessages(message: AssistantMessage, parts: MessagePart[]): ModelMessage[] {
  const results: ModelMessage[] = []
  const content = buildAssistantContent(message, parts)
  if (content.length > 0) {
    results.push({
      role: "assistant",
      content,
    })
  }

  for (const part of parts) {
    if (part.type !== "tool") continue
    const toolMessage = toToolResultMessage(part)
    if (toolMessage) results.push(toolMessage)
  }

  return results
}

function buildAssistantContent(message: AssistantMessage, parts: MessagePart[]): ModelContentBlock[] {
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
      toolName: part.toolName,
      input: part.state.input,
      content: [
        {
          type: "tool-output",
          output: part.state.output,
          title: part.state.title,
          metadata: part.state.metadata,
        },
      ],
    }
  }

  if (part.state.status !== "error") return undefined

  return {
    role: "tool",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    input: part.state.input,
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

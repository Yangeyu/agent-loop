// Cheap, provider-agnostic token estimator (~4 chars/token) used to drive
// proactive compaction. Not exact — only needs to be monotonic enough to gate.
import type { ModelMessage } from "@harness/llm/types"

const CHARS_PER_TOKEN = 4

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function estimateModelTokens(system: string[], messages: ModelMessage[]): number {
  let chars = system.join("\n").length
  for (const message of messages) {
    for (const block of message.content) {
      chars += blockChars(block)
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

function blockChars(block: ModelMessage["content"][number]): number {
  switch (block.type) {
    case "text":
    case "reasoning":
    case "context-summary":
    case "error":
      return block.text.length
    case "tool-output":
      return block.output.length + (block.title?.length ?? 0)
    case "tool-error":
      return block.error.length + block.toolName.length
    case "structured-output":
      return typeof block.data === "string" ? block.data.length : JSON.stringify(block.data).length
  }
}

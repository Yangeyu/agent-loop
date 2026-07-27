// Cheap, provider-agnostic token estimator (~4 chars/token) used to drive
// proactive compaction. Not exact — only needs to be monotonic enough to gate.
import type { ModelMessage } from "@agent-core"

const CHARS_PER_TOKEN = 4
// Flat nominal token cost per image. Images aren't counted by their (potentially
// huge base64) length — that would swamp the estimate — so the gate uses a fixed
// monotonic weight instead.
const IMAGE_TOKEN_ESTIMATE = 1024

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
    case "image":
      return IMAGE_TOKEN_ESTIMATE * CHARS_PER_TOKEN
  }
}

// Cheap, provider-agnostic token estimator that drives proactive compaction:
// monotonic enough to gate, nothing more.
import type { ModelMessage } from "@agent-core"

const CHARS_PER_TOKEN = 4
// Flat nominal cost per image, keeping huge base64 payloads from swamping the estimate.
const IMAGE_TOKEN_ESTIMATE = 1024

/** Estimates prompt tokens for a draft (~4 chars/token; images at a flat weight). */
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

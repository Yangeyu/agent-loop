import type { ModelContentBlock } from "@harness/llm/types"

export function renderTaggedText(blocks: ModelContentBlock[]) {
  return blocks.map((block) => renderTaggedTextBlock(block)).filter(Boolean).join("\n\n")
}

function renderTaggedTextBlock(block: ModelContentBlock) {
  if (block.type === "text") return block.text
  if (block.type === "reasoning") return ["<reasoning>", block.text, "</reasoning>"].join("\n")
  if (block.type === "structured-output") {
    return [
      "<structured-output>",
      typeof block.data === "string" ? block.data : JSON.stringify(block.data),
      "</structured-output>",
    ].join("\n")
  }
  if (block.type === "context-summary") {
    return ["<context-summary>", block.text, "</context-summary>"].join("\n")
  }
  if (block.type === "tool-output") {
    return [
      block.title ? `<title>${block.title}</title>` : "",
      block.metadata !== undefined ? `<metadata>${serializeUnknown(block.metadata)}</metadata>` : "",
      `<output>${block.output}</output>`,
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

function serializeUnknown(value: unknown) {
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

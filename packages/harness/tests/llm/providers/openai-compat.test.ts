import { describe, expect, it } from "bun:test"
import { buildMessageContent } from "@harness/llm/providers/openai-compat"
import { resolveModelSpec } from "@harness/llm/models"
import type { ModelContentBlock } from "@harness/llm/types"

describe("openai-compat buildMessageContent", () => {
  it("keeps text-only content as a flattened string", () => {
    expect(buildMessageContent([{ type: "text", text: "hello" }])).toBe("hello")
  })

  it("switches to a multimodal array when an image block is present", () => {
    const blocks: ModelContentBlock[] = [
      { type: "text", text: "look" },
      { type: "image", source: { kind: "url", url: "https://example.com/a.png" } },
    ]

    expect(buildMessageContent(blocks)).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ])
  })

  it("encodes a base64 source as a data URL", () => {
    expect(buildMessageContent([{ type: "image", source: { kind: "base64", data: "AAA", mime: "image/png" } }])).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ])
  })
})

describe("resolveModelSpec provider routing", () => {
  it("defaults to the default provider's default model", () => {
    const spec = resolveModelSpec()
    expect(spec.id).toBe("qwen3.7-plus")
    expect(spec.capabilities.vision).toBe(true)
    expect(spec.contextWindow).toBe(262144)
  })

  it("resolves a specific model within a provider", () => {
    const spec = resolveModelSpec({ providerID: "dashscope", modelID: "qwen3.6-flash" })
    expect(spec.id).toBe("qwen3.6-flash")
    expect(spec.capabilities.vision).toBe(false)
    expect(spec.contextWindow).toBe(131072)
  })

  it("throws on an unknown provider", () => {
    expect(() => resolveModelSpec({ providerID: "nope" })).toThrow(/Unknown model provider/)
  })
})

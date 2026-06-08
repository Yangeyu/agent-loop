import { describe, expect, it } from "bun:test"
import { buildMessageContent, mapMessages } from "@harness/llm/providers/openai-compat"
import { createDashScopeModel } from "@harness/llm/providers/dashscope"
import type { ModelContentBlock, ModelMessage } from "@harness/llm/types"

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

describe("openai-compat mapMessages tool grouping", () => {
  it("maps an assistant turn to one message with all tool_calls, then the tool results", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "calling" }],
        toolCalls: [
          { id: "c1", name: "read", input: { path: "a" } },
          { id: "c2", name: "read", input: { path: "b" } },
        ],
      },
      { role: "tool", toolCallId: "c1", content: [{ type: "tool-output", output: "A" }] },
      { role: "tool", toolCallId: "c2", content: [{ type: "tool-output", output: "B" }] },
    ]

    const out = mapMessages(messages)

    expect(out).toHaveLength(3)
    expect(out[0].role).toBe("assistant")
    expect(out[0].content).toBe("calling")
    expect(out[0].tool_calls).toEqual([
      { id: "c1", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "a" }) } },
      { id: "c2", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "b" }) } },
    ])
    expect(out[1]).toMatchObject({ role: "tool", tool_call_id: "c1" })
    expect(out[2]).toMatchObject({ role: "tool", tool_call_id: "c2" })
  })

  it("omits tool_calls on an assistant message that issued none", () => {
    const out = mapMessages([{ role: "assistant", content: [{ type: "text", text: "done" }] }])
    expect(out[0]).toEqual({ role: "assistant", content: "done" })
  })
})

describe("createDashScopeModel spec binding", () => {
  it("binds the default qwen model", () => {
    const model = createDashScopeModel()
    expect(model.providerID).toBe("dashscope")
    expect(model.spec.id).toBe("qwen3.7-plus")
    expect(model.spec.capabilities.vision).toBe(true)
    expect(model.spec.contextWindow).toBe(262144)
  })

  it("binds a specific model by id", () => {
    const model = createDashScopeModel({ modelID: "qwen3.6-flash" })
    expect(model.spec.id).toBe("qwen3.6-flash")
    expect(model.spec.capabilities.vision).toBe(false)
    expect(model.spec.contextWindow).toBe(131072)
  })

  it("throws on an unknown model id", () => {
    expect(() => createDashScopeModel({ modelID: "nope" })).toThrow(/Unknown DashScope model "nope"/)
  })
})

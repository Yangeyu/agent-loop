import { describe, expect, it } from "bun:test"
import { toModelMessages } from "@harness/llm/message"
import type { AssistantMessage, MessagePart, SessionInfo, ToolPart, UserMessage } from "@harness/types"

function userSession(parts: MessagePart[]): SessionInfo {
  const user: UserMessage = {
    id: "u1",
    role: "user",
    agent: "lead",
    time: { created: 0 },
  }
  return { id: "s1", rootID: "s1", title: "t", messages: [user], parts: { u1: parts } }
}

function completedToolPart(toolCallId: string, toolName: string, input: unknown, output: string): ToolPart {
  return {
    id: `p-${toolCallId}`,
    type: "tool",
    toolName,
    toolCallId,
    state: { status: "completed", input, output, time: { start: 0, end: 1 } },
  }
}

describe("toModelMessages image projection", () => {
  it("projects an image part into an image content block alongside text", () => {
    const session = userSession([
      { id: "t1", type: "text", text: "look at this" },
      { id: "i1", type: "image", source: { kind: "url", url: "https://example.com/a.png" } },
    ])

    const [message] = toModelMessages(session)
    expect(message.role).toBe("user")
    expect(message.content).toContainEqual({ type: "image", source: { kind: "url", url: "https://example.com/a.png" } })
    expect(message.content.some((block) => block.type === "text" && block.text === "look at this")).toBe(true)
  })

  it("emits a user message even when the only content is an image", () => {
    const session = userSession([
      { id: "i1", type: "image", source: { kind: "base64", data: "AAA", mime: "image/png" } },
    ])

    const messages = toModelMessages(session)
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toEqual([{ type: "image", source: { kind: "base64", data: "AAA", mime: "image/png" } }])
  })
})

describe("toModelMessages tool-call projection", () => {
  function assistantToolSession(parts: MessagePart[]): SessionInfo {
    const user: UserMessage = {
      id: "u1",
      role: "user",
      agent: "lead",
      time: { created: 0 },
    }
    const assistant: AssistantMessage = {
      id: "a1",
      role: "assistant",
      parentID: "u1",
      agent: "lead",
      model: { providerID: "dashscope", modelID: "qwen3.7-plus" },
      time: { created: 1 },
    }
    return {
      id: "s1",
      rootID: "s1",
      title: "t",
      messages: [user, assistant],
      parts: { u1: [{ id: "t1", type: "text", text: "go" }], a1: parts },
    }
  }

  it("lifts resolved tool calls onto the assistant message, each with one tool result", () => {
    const session = assistantToolSession([
      { id: "txt", type: "text", text: "calling tools" },
      completedToolPart("c1", "read", { path: "a" }, "A"),
      completedToolPart("c2", "read", { path: "b" }, "B"),
    ])

    const [, assistant, toolA, toolB] = toModelMessages(session)

    expect(assistant.role).toBe("assistant")
    expect(assistant.role === "assistant" && assistant.toolCalls).toEqual([
      { id: "c1", name: "read", input: { path: "a" } },
      { id: "c2", name: "read", input: { path: "b" } },
    ])
    expect(toolA).toMatchObject({ role: "tool", toolCallId: "c1" })
    expect(toolB).toMatchObject({ role: "tool", toolCallId: "c2" })
    // The tool message carries only the result, not the call request.
    expect(toolA).not.toHaveProperty("input")
    expect(toolA).not.toHaveProperty("toolName")
  })

  it("emits an assistant message carrying tool_calls even with no text content", () => {
    const session = assistantToolSession([completedToolPart("c1", "read", { path: "a" }, "A")])

    const [, assistant] = toModelMessages(session)
    expect(assistant.role).toBe("assistant")
    expect(assistant.content).toEqual([])
    expect(assistant.role === "assistant" && assistant.toolCalls).toEqual([{ id: "c1", name: "read", input: { path: "a" } }])
  })

  it("omits a still-running tool call so no dangling call is projected", () => {
    const session = assistantToolSession([
      { id: "txt", type: "text", text: "thinking" },
      { id: "p-c1", type: "tool", toolName: "read", toolCallId: "c1", state: { status: "running", input: {}, time: { start: 0 } } },
    ])

    const messages = toModelMessages(session)
    const assistant = messages.find((message) => message.role === "assistant")
    expect(assistant?.role === "assistant" && assistant.toolCalls).toBeUndefined()
    expect(messages.some((message) => message.role === "tool")).toBe(false)
  })
})

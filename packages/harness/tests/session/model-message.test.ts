import { describe, expect, it } from "bun:test"
import { toModelMessages } from "@harness/session/model-message"
import type { MessagePart, SessionInfo, UserMessage } from "@harness/types"

function userSession(parts: MessagePart[]): SessionInfo {
  const user: UserMessage = {
    id: "u1",
    role: "user",
    sessionID: "s1",
    agent: "lead",
    model: { providerID: "dashscope", modelID: "qwen3.7-plus" },
    time: { created: 0 },
  }
  return { id: "s1", title: "t", messages: [user], parts: { u1: parts } }
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

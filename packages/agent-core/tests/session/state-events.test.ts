// The architecture's core invariant: the state channel is a complete record of
// session mutation. Folding a session's state events with the shared reducer
// must reproduce exactly the session the aggregate stored — if these diverge,
// a write bypassed the aggregate or an event misdescribes its write.
import { describe, expect, it } from "bun:test"
import { defineHarnessAgent } from "@harness/registry"
import { applyStateEvent, emptyProjection, type SessionProjection } from "@agent-core/model"
import {
  baseMiddleware,
  createTestRuntime,
  runPrompt,
} from "@harness"
import {
  type StateEvent,
} from "@agent-core"
import type { LLMChunk } from "@agent-core/llm/types"
import { createFakeModel } from "@agent-core"

const TURN_SCRIPT: LLMChunk[] = [
  { type: "reasoning", textDelta: "let me think" },
  { type: "reasoning", textDelta: " about this" },
  { type: "text-delta", textDelta: "here is " },
  { type: "text-delta", textDelta: "the answer" },
  { type: "finish", finishReason: "stop" },
]

async function buildRuntime() {
  const agent = defineHarnessAgent({
    name: "lead",
    mode: "primary",
    steps: 4,
    model: createFakeModel({ chunks: TURN_SCRIPT }),
    middleware: [...baseMiddleware()],
  })
  return createTestRuntime({ agents: [agent] })
}

describe("state channel completeness", () => {
  it("folding the state events reproduces the stored session", async () => {
    const runtime = await buildRuntime()

    const projections = new Map<string, SessionProjection>()
    runtime.events.state.subscribe((event: StateEvent) => {
      const current = projections.get(event.sessionID) ?? emptyProjection
      projections.set(event.sessionID, applyStateEvent(current, event))
    })

    const first = await runPrompt({ runtime, agent: "lead", text: "first question" })
    await runPrompt({ runtime, agent: "lead", sessionID: first.id, text: "second question" })

    const stored = runtime.sessions.get(first.id)
    const projected = projections.get(first.id)

    expect(projected).toBeDefined()
    expect(projected?.messages).toEqual(stored.messages)
    expect(projected?.parts).toEqual(stored.parts)

    // Sanity: the run actually produced streamed content to fold.
    expect(stored.messages.length).toBe(4)
    const answer = stored.messages[1]
    expect(runtime.sessions.messageText(first.id, answer.id)).toBe("here is the answer")
  })
})

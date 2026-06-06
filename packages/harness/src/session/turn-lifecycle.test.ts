import { describe, expect, it } from "bun:test"
import { createAgentRegistry } from "@harness/agent/registry"
import { loadConfigFromEnv } from "@harness/config"
import { createRuntimeEvents } from "@harness/runtime/events"
import type { ProcessorContext } from "@harness/session/processor-context"
import { MemorySessionStore } from "@harness/session/store"
import { TurnLifecycle } from "@harness/session/turn-lifecycle"
import { createSkillRegistry } from "@harness/skill/registry"
import { createToolRegistry } from "@harness/tool/registry"
import type { AssistantMessage, UserMessage } from "@harness/types"

describe("TurnLifecycle structured output", () => {
  it("captures parsed JSON into assistant.structured on finish", () => {
    const { lifecycle, store, sessionID, assistantID } = createLifecycleHarness({
      format: {
        type: "json_schema",
        schema: {
          type: "object",
        },
      },
    })

    lifecycle.appendText('{"ok":true}')
    lifecycle.finish("stop")

    const assistant = store.get(sessionID).messages.find((message) => message.id === assistantID) as AssistantMessage
    expect(assistant.structured).toEqual({ ok: true })
    expect(assistant.error).toBeUndefined()
  })

  it("fails the turn when structured output is not valid JSON", () => {
    const { lifecycle, store, sessionID, assistantID } = createLifecycleHarness({
      format: {
        type: "json_schema",
        schema: {
          type: "object",
        },
      },
    })

    lifecycle.appendText("not json")
    lifecycle.finish("stop")

    const assistant = store.get(sessionID).messages.find((message) => message.id === assistantID) as AssistantMessage
    expect(assistant.structured).toBeUndefined()
    expect(assistant.finish).toBe("error")
    expect(assistant.error?.code).toBe("invalid_structured_output")
  })
})

function createLifecycleHarness(input: { format: UserMessage["format"] }) {
  const config = loadConfigFromEnv({})
  const store = new MemorySessionStore()
  const session = store.create({ title: "Structured output test" })
  const user: UserMessage = {
    id: "user-1",
    role: "user",
    sessionID: session.id,
    agent: "build",
    model: {
      providerID: "fake",
      modelID: "fake",
    },
    format: input.format,
    time: {
      created: Date.now(),
    },
  }
  store.appendUserMessage(session.id, user)

  const assistant: AssistantMessage = {
    id: "assistant-1",
    role: "assistant",
    sessionID: session.id,
    parentID: user.id,
    agent: "build",
    model: {
      providerID: "fake",
      modelID: "fake",
    },
    time: {
      created: Date.now(),
    },
  }
  store.appendAssistantMessage(session.id, assistant)

  const agent_registry = createAgentRegistry()
  agent_registry.register({
    name: "build",
    mode: "primary",
  })

  const context: ProcessorContext = {
    config,
    agent_registry,
    skill_registry: createSkillRegistry(),
    session_store: store,
    tool_registry: createToolRegistry(),
    events: createRuntimeEvents(),
    session,
    user,
    assistant,
    agent: agent_registry.get("build"),
    system: [],
    messages: [],
    tools: [],
    policy: {
      retry: {
        maxRetries: 0,
        baseDelayMs: 1,
        maxDelayMs: 1,
      },
      timeout: {
        turnTimeoutMs: 1000,
      },
      budget: {
        maxSteps: 4,
        maxAgentSteps: 4,
        maxToolCalls: 4,
        repeatedToolFailureThreshold: 3,
        maxSessionSteps: 4,
        sessionStepsUsed: 0,
        sessionStepsRemaining: 4,
        maxSubagentDepth: 2,
      },
    },
    abort: new AbortController().signal,
    startedAt: Date.now(),
    phase: "streaming",
    toolCalls: 0,
    retryCount: 0,
    sawReasoning: false,
    sawText: false,
    recentToolCalls: [],
    recentToolFailures: [],
  }

  return {
    lifecycle: new TurnLifecycle(context),
    store,
    sessionID: session.id,
    assistantID: assistant.id,
  }
}

import { describe, expect, it } from "bun:test"
import { createAgentRegistry } from "@harness/agent/registry"
import { defineAgent } from "@harness/agent/types"
import { loadConfigFromEnv } from "@harness/config"
import { createTurnContext } from "@harness/core/context"
import { resolveTurnExecutionPolicy } from "@harness/core/policy"
import { StreamSink } from "@harness/core/stream-sink"
import { dispatchToolCall } from "@harness/core/tool-call"
import { MiddlewareStack } from "@harness/hooks/stack"
import { createRuntimeEvents } from "@harness/runtime/events"
import { MemorySessionStore } from "@harness/session/store"
import { createSkillRegistry } from "@harness/skill/registry"
import { defineTool } from "@harness/tool/tool"
import { createToolRegistry } from "@harness/tool/registry"
import type { AssistantMessage, ToolContext, ToolDefinition, UserMessage } from "@harness/types"
import { z } from "zod"
import { createFakeModel } from "../support/fake-model"

const stubModel = createFakeModel()

describe("defineTool", () => {
  it("merges execute and afterExecute metadata", async () => {
    const tool = defineTool({
      id: "merge_metadata",
      description: "Test metadata merging",
      parameters: z.object({}),
      async execute() {
        return { output: "ok", metadata: { fromExecute: true } }
      },
      afterExecute() {
        return { metadata: { fromAfterExecute: true } }
      },
    })

    const result = await tool.execute({}, createToolContextStub())

    expect(result.metadata).toEqual({ fromExecute: true, fromAfterExecute: true })
  })
})

describe("dispatchToolCall", () => {
  it("reuses validated args without parsing twice", async () => {
    let parseCount = 0

    const tool = defineTool({
      id: "single_parse",
      description: "Test validated execution path",
      parameters: z.object({
        value: z.string().transform((input) => {
          parseCount += 1
          return input
        }),
      }),
      async execute(args) {
        return { output: args.value }
      },
    })

    const { dispatch } = createToolCallHarness(tool)
    await dispatch({ toolCallId: "call-parse-once", toolName: tool.id, args: { value: "ok" } })

    expect(parseCount).toBe(1)
  })

  it("preserves beforeExecute title and metadata on completed parts", async () => {
    const tool = defineTool({
      id: "complete_preserves_metadata",
      description: "Test completed tool part state",
      parameters: z.object({}),
      beforeExecute() {
        return { title: "Prepared title", metadata: { fromBeforeExecute: true } }
      },
      async execute() {
        return { output: "done" }
      },
    })

    const { dispatch, store, sessionID, assistantID } = createToolCallHarness(tool)
    await dispatch({ toolCallId: "call-complete", toolName: tool.id, args: {} })

    const part = store.getParts(sessionID, assistantID).find((item) => item.type === "tool")
    expect(part?.state.status).toBe("completed")
    if (!part || part.state.status !== "completed") throw new Error("Expected completed tool part")

    expect(part.state.title).toBe("Prepared title")
    expect(part.state.metadata).toEqual({ fromBeforeExecute: true })
  })

  it("preserves beforeExecute title and metadata on errored parts", async () => {
    const tool = defineTool({
      id: "error_preserves_metadata",
      description: "Test errored tool part state",
      parameters: z.object({}),
      beforeExecute() {
        return { title: "Prepared title", metadata: { fromBeforeExecute: true } }
      },
      async execute() {
        throw new Error("boom")
      },
    })

    const { dispatch, store, sessionID, assistantID } = createToolCallHarness(tool)
    await dispatch({ toolCallId: "call-error", toolName: tool.id, args: {} })

    const part = store.getParts(sessionID, assistantID).find((item) => item.type === "tool")
    expect(part?.state.status).toBe("error")
    if (!part || part.state.status !== "error") throw new Error("Expected errored tool part")

    expect(part.state.title).toBe("Prepared title")
    expect(part.state.metadata).toEqual({ fromBeforeExecute: true })
  })
})

function createToolContextStub(): ToolContext {
  return {
    config: loadConfigFromEnv({}),
    agent_registry: createAgentRegistry(),
    skill_registry: createSkillRegistry(),
    session_store: new MemorySessionStore(),
    tool_registry: createToolRegistry(),
    events: createRuntimeEvents(),
    sessionID: "session-1",
    messageID: "message-1",
    turnID: "turn-1",
    agent: "lead",
    abort: new AbortController().signal,
    format: { type: "text" },
    messages: [],
    metadata: async () => {},
    executeTool: async () => ({ status: "error", error: { message: "not implemented", retryable: false } }),
  }
}

function createToolCallHarness(tool: ToolDefinition) {
  const config = loadConfigFromEnv({})
  const store = new MemorySessionStore()
  const session = store.create({ title: "Test session" })

  const agent = defineAgent({ name: "lead", mode: "primary", steps: 4, model: stubModel })
  const agent_registry = createAgentRegistry()
  agent_registry.register(agent)

  const skill_registry = createSkillRegistry()
  const tool_registry = createToolRegistry()
  tool_registry.register(tool)
  const events = createRuntimeEvents()

  const model = { providerID: "dashscope", modelID: "qwen3.7-plus" }
  const user: UserMessage = {
    id: "user-1",
    role: "user",
    sessionID: session.id,
    agent: "lead",
    model,
    format: { type: "text" },
    time: { created: Date.now() },
  }
  store.appendUserMessage(session.id, user)

  const assistant: AssistantMessage = {
    id: "assistant-1",
    role: "assistant",
    sessionID: session.id,
    parentID: user.id,
    agent: "lead",
    model,
    time: { created: Date.now() },
  }
  store.appendAssistantMessage(session.id, assistant)

  const deps = {
    config,
    agent_registry,
    skill_registry,
    session_store: store,
    tool_registry,
    events,
  }

  const ctx = createTurnContext({
    deps,
    agent,
    model: agent.model,
    policy: resolveTurnExecutionPolicy(config, agent, store.get(session.id)),
    sessionID: session.id,
    user,
    assistant,
    tools: [tool],
    step: 1,
    abort: new AbortController().signal,
  })
  ctx.phase = "streaming"

  const stack = MiddlewareStack.build([])
  const sink = new StreamSink(ctx)

  return {
    dispatch: (chunk: { toolCallId: string; toolName: string; args: unknown }) =>
      dispatchToolCall(ctx, stack, sink, chunk),
    store,
    sessionID: session.id,
    assistantID: assistant.id,
  }
}

import { describe, expect, it } from "bun:test"
import { createAgentRegistry } from "@harness/agent/registry"
import { loadConfigFromEnv } from "@harness/config"
import { createRuntimeEvents } from "@harness/runtime/events"
import type { ProcessorContext } from "@harness/session/processor-context"
import { ToolCallExecutor } from "@harness/session/tool-executor"
import { TurnLifecycle } from "@harness/session/turn-lifecycle"
import { MemorySessionStore } from "@harness/session/store"
import { createSkillRegistry } from "@harness/skill/registry"
import { defineTool } from "@harness/tool/tool"
import { createToolRegistry } from "@harness/tool/registry"
import type { AssistantMessage, ToolContext, UserMessage } from "@harness/types"
import { z } from "zod"

describe("defineTool", () => {
  it("merges execute and afterExecute metadata", async () => {
    const tool = defineTool({
      id: "merge_metadata",
      description: "Test metadata merging",
      parameters: z.object({}),
      async execute() {
        return {
          output: "ok",
          metadata: {
            fromExecute: true,
          },
        }
      },
      afterExecute() {
        return {
          metadata: {
            fromAfterExecute: true,
          },
        }
      },
    })

    const result = await tool.execute({}, createToolContextStub())

    expect(result.metadata).toEqual({
      fromExecute: true,
      fromAfterExecute: true,
    })
  })
})

describe("ToolCallExecutor", () => {
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
        return {
          output: args.value,
        }
      },
    })

    const { executor } = createExecutorHarness(tool)
    await executor.execute({
      toolCallId: "call-parse-once",
      toolName: tool.id,
      args: {
        value: "ok",
      },
    })

    expect(parseCount).toBe(1)
  })

  it("preserves beforeExecute title and metadata on completed parts", async () => {
    const tool = defineTool({
      id: "complete_preserves_metadata",
      description: "Test completed tool part state",
      parameters: z.object({}),
      beforeExecute() {
        return {
          title: "Prepared title",
          metadata: {
            fromBeforeExecute: true,
          },
        }
      },
      async execute() {
        return {
          output: "done",
        }
      },
    })

    const { executor, store, sessionID, assistantID } = createExecutorHarness(tool)
    await executor.execute({
      toolCallId: "call-complete",
      toolName: tool.id,
      args: {},
    })

    const parts = store.getParts(sessionID, assistantID)
    const part = parts.find((item) => item.type === "tool")
    expect(part?.state.status).toBe("completed")
    if (!part || part.state.status !== "completed") throw new Error("Expected completed tool part")

    expect(part.state.title).toBe("Prepared title")
    expect(part.state.metadata).toEqual({
      fromBeforeExecute: true,
    })
  })

  it("preserves beforeExecute title and metadata on errored parts", async () => {
    const tool = defineTool({
      id: "error_preserves_metadata",
      description: "Test errored tool part state",
      parameters: z.object({}),
      beforeExecute() {
        return {
          title: "Prepared title",
          metadata: {
            fromBeforeExecute: true,
          },
        }
      },
      async execute() {
        throw new Error("boom")
      },
    })

    const { executor, store, sessionID, assistantID } = createExecutorHarness(tool)
    await executor.execute({
      toolCallId: "call-error",
      toolName: tool.id,
      args: {},
    })

    const parts = store.getParts(sessionID, assistantID)
    const part = parts.find((item) => item.type === "tool")
    expect(part?.state.status).toBe("error")
    if (!part || part.state.status !== "error") throw new Error("Expected errored tool part")

    expect(part.state.title).toBe("Prepared title")
    expect(part.state.metadata).toEqual({
      fromBeforeExecute: true,
    })
  })
})

function createToolContextStub(): ToolContext {
  const config = loadConfigFromEnv({})
  const agent_registry = createAgentRegistry()
  const skill_registry = createSkillRegistry()
  const session_store = new MemorySessionStore()
  const tool_registry = createToolRegistry()
  const events = createRuntimeEvents()

  return {
    config,
    agent_registry,
    skill_registry,
    session_store,
    tool_registry,
    events,
    sessionID: "session-1",
    messageID: "message-1",
    turnID: "turn-1",
    agent: "build",
    abort: new AbortController().signal,
    format: { type: "text" },
    messages: [],
    metadata: async () => {},
    executeTool: async () => ({
      status: "error",
      error: {
        message: "not implemented",
        retryable: false,
      },
    }),
  }
}

function createExecutorHarness(tool: ReturnType<typeof defineTool>) {
  const config = loadConfigFromEnv({})
  const store = new MemorySessionStore()
  const session = store.create({ title: "Test session" })
  const user: UserMessage = {
    id: "user-1",
    role: "user",
    sessionID: session.id,
    agent: "build",
    model: {
      providerID: "fake",
      modelID: "fake",
    },
    format: { type: "text" },
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

  const skill_registry = createSkillRegistry()
  const tool_registry = createToolRegistry()
  tool_registry.register(tool)
  const events = createRuntimeEvents()

  const context: ProcessorContext = {
    config,
    agent_registry,
    skill_registry,
    session_store: store,
    tool_registry,
    events,
    session,
    user,
    assistant,
    agent: agent_registry.get("build"),
    system: [],
    messages: [],
    tools: [tool],
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
    executor: new ToolCallExecutor(context, new TurnLifecycle(context)),
    store,
    sessionID: session.id,
    assistantID: assistant.id,
  }
}

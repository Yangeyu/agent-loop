import { describe, expect, it } from "bun:test"
import { createToolContext } from "@agent-core"
import { defineHarnessAgent } from "@harness/registry"
import { loadConfigFromEnv } from "@harness/config"
import { createRunContext, createTurnContext } from "@agent-core/context"
import { resolveTurnExecutionPolicy } from "@agent-core/policy"
import { TurnRecorder } from "@agent-core/recorder"
import { executeToolCall, openToolPart, prepareToolCall } from "@agent-core/tool-call"
import { MiddlewareStack } from "@agent-core/hooks"
import { createRuntimeEvents } from "@agent-core/event/bus"
import { MemorySessionPersistence, Sessions } from "@agent-core/session"
import { createReadTool } from "@harness/tools/read"
import { normalizeTavilyResponse } from "@harness/tools/tavily"
import { defineTool } from "@agent-core/tool/tool"
import { createWorkspace } from "@harness/workspace"
import type { AssistantMessage, ToolDefinition, ToolDisplay, ToolPart, UserMessage } from "@agent-core/types"
import { z } from "zod"
import { createFakeModel } from "@agent-core"

const ReadTool = createReadTool({ workspace: createWorkspace() })

const stubModel = createFakeModel()

describe("read", () => {
  it("reads UTF-8 text files with metadata", async () => {
    const file = new File(["hello\nworld"], "sample.txt", { type: "text/plain" })
    const target = await Bun.write(Bun.file("/tmp/agent-loop-read-file-test.txt"), file)
    expect(target).toBe(11)

    const result = await ReadTool.execute({ filePath: "/tmp/agent-loop-read-file-test.txt" }, createToolContext())

    expect(result.output).toBe("hello\nworld")
    // truncated is what the model must be able to trust: false means the output
    // above really is the whole file.
    expect(result.metadata?.truncated).toBe(false)
    expect(result.metadata?.bytes).toBe(11)
  })
})

describe("tavily", () => {
  it("normalizes Tavily search responses", () => {
    expect(normalizeTavilyResponse({
      query: "agent loops",
      answer: "Agent loops run tools iteratively.",
      results: [
        {
          title: "Agent Loop",
          url: "https://example.com/agent-loop",
          content: "A page about agent loops.",
          score: 0.91,
          ignored: true,
        },
      ],
    }, "fallback")).toEqual({
      query: "agent loops",
      answer: "Agent loops run tools iteratively.",
      totalResults: 1,
      results: [
        {
          title: "Agent Loop",
          url: "https://example.com/agent-loop",
          content: "A page about agent loops.",
          score: 0.91,
        },
      ],
    })
  })
})

describe("executeToolCall", () => {
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

  it("preserves beforeExecute display and metadata on completed parts", async () => {
    const tool = defineTool({
      id: "complete_preserves_metadata",
      description: "Test completed tool part state",
      parameters: z.object({}),
      beforeExecute() {
        return { display: { verb: "prepare", target: "the thing" }, metadata: { fromBeforeExecute: true } }
      },
      async execute() {
        return { output: "done" }
      },
    })

    const { dispatch, sessions, sessionID, assistantID } = createToolCallHarness(tool)
    await dispatch({ toolCallId: "call-complete", toolName: tool.id, args: {} })

    const part = sessions.parts(sessionID, assistantID).find((item): item is ToolPart => item.type === "tool")
    expect(part?.state.status).toBe("completed")
    if (!part || part.state.status !== "completed") throw new Error("Expected completed tool part")

    expect(part.state.display).toEqual({ verb: "prepare", target: "the thing", summary: undefined })
    expect(part.state.metadata).toEqual({ fromBeforeExecute: true })
  })

  it("preserves beforeExecute display and metadata on errored parts", async () => {
    const tool = defineTool({
      id: "error_preserves_metadata",
      description: "Test errored tool part state",
      parameters: z.object({}),
      beforeExecute() {
        return { display: { verb: "prepare", target: "the thing" }, metadata: { fromBeforeExecute: true } }
      },
      async execute() {
        throw new Error("boom")
      },
    })

    const { dispatch, sessions, sessionID, assistantID } = createToolCallHarness(tool)
    await dispatch({ toolCallId: "call-error", toolName: tool.id, args: {} })

    const part = sessions.parts(sessionID, assistantID).find((item): item is ToolPart => item.type === "tool")
    expect(part?.state.status).toBe("error")
    if (!part || part.state.status !== "error") throw new Error("Expected errored tool part")

    expect(part.state.display).toEqual({ verb: "prepare", target: "the thing", summary: undefined })
    expect(part.state.metadata).toEqual({ fromBeforeExecute: true })
  })

  it("opens the part already carrying what describe() derived from the args", async () => {
    // The contract the transcript depends on. When display only arrived later,
    // a row appeared naming the tool but not its subject for the whole time the
    // call was in flight — which is exactly when someone is watching it.
    const tool = defineTool({
      id: "described",
      description: "Test describe-at-open",
      parameters: z.object({ path: z.string() }),
      describe(args) {
        return { verb: "write", target: args.path }
      },
      async execute() {
        return { output: "done" }
      },
    })

    const { dispatch, events } = createToolCallHarness(tool)
    const opened: ToolDisplay[] = []
    events.state.subscribe((event) => {
      if (event.type === "part.created" && event.part.type === "tool") opened.push(event.part.state.display)
    })

    await dispatch({ toolCallId: "call-described", toolName: tool.id, args: { path: "/tmp/report.html" } })

    expect(opened).toEqual([
      { verb: "write", target: "/tmp/report.html", summary: undefined },
    ])
  })

  it("opens the part with validated args, not the raw ones", async () => {
    const tool = defineTool({
      id: "coerced",
      description: "Test validated input at open",
      parameters: z.object({ count: z.coerce.number() }),
      async execute() {
        return { output: "done" }
      },
    })

    const { dispatch, events } = createToolCallHarness(tool)
    const opened: unknown[] = []
    events.state.subscribe((event) => {
      if (event.type === "part.created" && event.part.type === "tool") opened.push(event.part.state.input)
    })

    await dispatch({ toolCallId: "call-coerced", toolName: tool.id, args: { count: "3" } })

    expect(opened).toEqual([{ count: 3 }])
  })

  it("emits part.created and part.updated state events for a completed call", async () => {
    const tool = defineTool({
      id: "state_events",
      description: "Test state event emission",
      parameters: z.object({}),
      async execute() {
        return { output: "done" }
      },
    })

    const { dispatch, events } = createToolCallHarness(tool)
    const seen: string[] = []
    events.state.subscribe((event) => {
      if (event.type === "part.created" && event.part.type === "tool") seen.push("created")
      if (event.type === "part.updated" && event.part.type === "tool") {
        seen.push(`updated:${event.part.state.status}`)
      }
    })

    await dispatch({ toolCallId: "call-events", toolName: tool.id, args: {} })

    // Two transitions, not three: the part is created already validated and
    // described, so nothing needs a follow-up "still running" update to correct
    // it. A tool that patches mid-flight adds its own updates on top.
    expect(seen).toEqual(["created", "updated:completed"])
  })
})

function createToolCallHarness(tool: ToolDefinition) {
  const config = loadConfigFromEnv({})
  const events = createRuntimeEvents()
  const sessions = new Sessions(new MemorySessionPersistence(), events.state)
  const session = sessions.create({ title: "Test session" })

  const agent = defineHarnessAgent({ name: "lead", mode: "primary", steps: 4, model: stubModel })

  const user: UserMessage = {
    id: "user-1",
    role: "user",
    agent: "lead",
    format: { type: "text" },
    time: { created: Date.now() },
  }
  sessions.appendMessage(session.id, user)

  const assistant: AssistantMessage = {
    id: "assistant-1",
    role: "assistant",
    parentID: user.id,
    agent: "lead",
    model: { providerID: "fake", modelID: stubModel.spec.id },
    time: { created: Date.now() },
  }

  const deps = { config, sessions, events }

  // Appends the assistant message and owns the turn lifecycle.
  const recorder = new TurnRecorder({
    sessions,
    loop: events.loop,
    sessionID: session.id,
    rootID: session.rootID,
    agent: agent.name,
    step: 1,
    maxSteps: 4,
    assistant,
  })
  recorder.enterPhase("streaming")

  const ctx = createTurnContext({
    run: createRunContext({
      deps,
      agent,
      model: agent.model,
      sessionID: session.id,
      abort: new AbortController().signal,
    }),
    deps,
    policy: resolveTurnExecutionPolicy(config, agent, sessions.get(session.id)),
    user,
    messageID: assistant.id,
    tools: [tool],
    step: 1,
    abort: new AbortController().signal,
    openActivity: (activity) => recorder.openActivity(activity),
  })

  const stack = MiddlewareStack.build([])

  return {
    // Both halves, in the order the turn runs them — so a test exercises the
    // same path production takes, including the display the part opens with.
    dispatch: async (chunk: { toolCallId: string; toolName: string; args: unknown }) => {
      const prepared = await prepareToolCall(ctx, stack, chunk)
      return executeToolCall(ctx, stack, recorder, chunk, openToolPart(recorder, chunk, prepared), prepared)
    },
    sessions,
    events,
    sessionID: session.id,
    assistantID: assistant.id,
  }
}

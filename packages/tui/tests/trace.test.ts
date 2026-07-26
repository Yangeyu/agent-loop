import { describe, expect, it } from "bun:test"
import { createTraceFolder } from "@tui/trace"
import type { TraceEntry } from "@tui/types"
import type { LoopEvent, StateEvent, ToolDisplay, ToolPart } from "@harness"

const ROOT = "session-root"
const CHILD = "session-child"

function createHarness(sessionID = ROOT) {
  let entries: TraceEntry[] = []
  let ids = 0

  const folder = createTraceFolder({
    createTraceID: () => `trace-${++ids}`,
    setTraceEntries: ((updater: TraceEntry[] | ((prev: TraceEntry[]) => TraceEntry[])) => {
      entries = typeof updater === "function" ? updater(entries) : updater
    }) as never,
  })

  folder.handleState({
    type: "session.created",
    sessionID,
    rootID: ROOT,
    session: { id: sessionID, rootID: ROOT, title: "t" },
  } as StateEvent)
  folder.handleLoop({ type: "session.start", sessionID, rootID: ROOT, agent: "lead", text: "go" } as LoopEvent)
  folder.handleState({
    type: "message.created",
    sessionID,
    rootID: ROOT,
    message: { id: "m1", role: "assistant", parentID: "u1", agent: "lead", model: { providerID: "p", modelID: "m" }, time: { created: 0 } },
  } as StateEvent)

  return {
    entries: () => entries,
    tools: () => entries.filter((entry) => entry.kind === "tool"),
    startTool: (partID: string, toolName: string, display: ToolDisplay, session = sessionID) => {
      const part: ToolPart = {
        id: partID,
        type: "tool",
        toolName,
        toolCallId: partID,
        state: { status: "running", input: {}, display, time: { start: 0 } },
      }
      folder.handleState({ type: "part.created", sessionID: session, rootID: ROOT, messageID: "m1", part } as StateEvent)
      return part
    },
    completeTool: (part: ToolPart, display: ToolDisplay, output = "done", session = sessionID) => {
      folder.handleState({
        type: "part.updated",
        sessionID: session,
        rootID: ROOT,
        messageID: "m1",
        part: { ...part, state: { status: "completed", input: {}, output, display, time: { start: 0, end: 1 } } },
      } as StateEvent)
    },
    folder,
  }
}

describe("trace tool rows", () => {
  it("carries the tool's own display instead of parsing its arguments", () => {
    const harness = createHarness()

    harness.startTool("p1", "task", { verb: "subagent", target: "general", summary: "find the caller" })

    expect(harness.tools()).toHaveLength(1)
    expect(harness.tools()[0].tool?.display).toEqual({
      verb: "subagent",
      target: "general",
      summary: "find the caller",
    })
  })

  it("folds a run of calls sharing a mergeKey into one row that counts them", () => {
    const harness = createHarness()
    const key = "write:/tmp/report.html"

    for (const id of ["p1", "p2", "p3"]) {
      const part = harness.startTool(id, "write", { verb: "write", target: "/tmp/report.html", mergeKey: key })
      harness.completeTool(part, { verb: "write", target: "/tmp/report.html", summary: "8 KB", mergeKey: key })
    }

    expect(harness.tools()).toHaveLength(1)
    expect(harness.tools()[0].tool?.calls).toBe(3)
    expect(harness.tools()[0].tool?.status).toBe("completed")
  })

  it("moves a folded row to the end so the newest activity stays at the bottom", () => {
    const harness = createHarness()
    const key = "write:/tmp/a.html"

    const first = harness.startTool("p1", "write", { verb: "write", target: "/tmp/a.html", mergeKey: key })
    harness.completeTool(first, { verb: "write", target: "/tmp/a.html", mergeKey: key })
    harness.startTool("p2", "read", { verb: "read", target: "/tmp/b.ts" })
    harness.startTool("p3", "write", { verb: "write", target: "/tmp/a.html", mergeKey: key })

    const rows = harness.tools()
    expect(rows).toHaveLength(2)
    expect(rows.at(-1)?.tool?.display.verb).toBe("write")
    expect(rows.at(-1)?.tool?.calls).toBe(2)
  })

  it("keeps calls apart when they do not share a mergeKey", () => {
    const harness = createHarness()

    harness.startTool("p1", "write", { verb: "write", target: "/tmp/a.html", mergeKey: "write:/tmp/a.html" })
    harness.startTool("p2", "write", { verb: "write", target: "/tmp/b.html", mergeKey: "write:/tmp/b.html" })
    harness.startTool("p3", "read", { verb: "read", target: "/tmp/c.ts" })

    expect(harness.tools()).toHaveLength(3)
  })

  it("never folds a subagent's calls into its parent's row", () => {
    const harness = createHarness()
    const key = "write:/tmp/shared.html"

    harness.startTool("p1", "write", { verb: "write", target: "/tmp/shared.html", mergeKey: key })
    harness.folder.handleState({
      type: "session.created",
      sessionID: CHILD,
      rootID: ROOT,
      session: { id: CHILD, parentID: ROOT, rootID: ROOT, title: "child" },
    } as StateEvent)
    harness.folder.handleLoop({ type: "session.start", sessionID: CHILD, rootID: ROOT, agent: "general", text: "sub" } as LoopEvent)
    harness.startTool("p2", "write", { verb: "write", target: "/tmp/shared.html", mergeKey: key }, CHILD)

    expect(harness.tools()).toHaveLength(2)
  })

  it("starts a fresh merge window on a new prompt", () => {
    const harness = createHarness()
    const key = "write:/tmp/report.html"

    harness.startTool("p1", "write", { verb: "write", target: "/tmp/report.html", mergeKey: key })
    harness.folder.handleLoop({ type: "session.start", sessionID: ROOT, rootID: ROOT, agent: "lead", text: "again" } as LoopEvent)
    harness.startTool("p2", "write", { verb: "write", target: "/tmp/report.html", mergeKey: key })

    expect(harness.tools()).toHaveLength(2)
  })

  it("shows what a running call is working on as soon as the tool declares it", () => {
    const harness = createHarness()
    // part.created carries only the tool's name; the target arrives with the
    // beforeExecute patch, while the call is still in flight.
    const part = harness.startTool("p1", "read", { verb: "read" })

    expect(harness.tools()[0].tool?.display.target).toBeUndefined()

    harness.folder.handleState({
      type: "part.updated",
      sessionID: ROOT,
      rootID: ROOT,
      messageID: "m1",
      part: { ...part, state: { status: "running", input: {}, display: { verb: "read", target: "/tmp/loop.ts" }, time: { start: 0 } } },
    } as StateEvent)

    expect(harness.tools()[0].tool?.status).toBe("running")
    expect(harness.tools()[0].tool?.display.target).toBe("/tmp/loop.ts")
  })

  it("carries the session chain so a delegated branch can be folded as a unit", () => {
    const harness = createHarness()

    harness.folder.handleState({
      type: "session.created",
      sessionID: CHILD,
      rootID: ROOT,
      session: { id: CHILD, parentID: ROOT, rootID: ROOT, title: "child" },
    } as StateEvent)
    harness.folder.handleLoop({ type: "session.start", sessionID: CHILD, rootID: ROOT, agent: "general", text: "sub" } as LoopEvent)
    harness.startTool("p1", "read", { verb: "read", target: "/tmp/x.ts" }, CHILD)

    const childRows = harness.entries().filter((entry) => entry.sessionID === CHILD)
    expect(childRows).not.toHaveLength(0)
    for (const row of childRows) expect(row.sessionChain).toEqual([ROOT, CHILD])

    const rootRows = harness.entries().filter((entry) => entry.sessionID === ROOT)
    for (const row of rootRows) expect(row.sessionChain).toEqual([ROOT])
  })

  it("records a failed call as an error row that still says what it tried", () => {
    const harness = createHarness()
    const part = harness.startTool("p1", "write", { verb: "write", target: "/tmp/report.html" })

    harness.folder.handleState({
      type: "part.updated",
      sessionID: ROOT,
      rootID: ROOT,
      messageID: "m1",
      part: {
        ...part,
        state: {
          status: "error",
          input: {},
          error: { message: "permission denied", retryable: false },
          display: { verb: "write", target: "/tmp/report.html" },
          time: { start: 0, end: 1 },
        },
      },
    } as StateEvent)

    expect(harness.tools()[0].tool?.status).toBe("error")
    expect(harness.tools()[0].tool?.display.target).toBe("/tmp/report.html")
  })
})

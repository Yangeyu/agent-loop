import { describe, expect, it } from "bun:test"
import {
  createRunningToolPart,
  toCompletedToolPart,
  toErroredToolPart,
  toMetadataPatchedToolPart,
} from "@harness/agent/tool-part"
import type { ToolPart } from "@harness/types"

function running(display?: Parameters<typeof createRunningToolPart>[0]["display"]): ToolPart {
  return createRunningToolPart({
    id: "part-1",
    toolName: "write",
    toolCallId: "call-1",
    input: {},
    display,
    startedAt: 0,
  })
}

describe("tool part display", () => {
  it("falls back to the tool name when a tool declares no verb", () => {
    expect(running().state.display).toEqual({
      verb: "write",
      target: undefined,
      summary: undefined,
    })
  })

  it("lets the result add only how the call went, keeping what it was about", () => {
    const part = running({ verb: "write", target: "/tmp/report.html" })

    const completed = toCompletedToolPart(part, {}, { display: { summary: "31.1 KB" }, output: "ok" })

    expect(completed.state.display).toEqual({
      verb: "write",
      target: "/tmp/report.html",
      summary: "31.1 KB",
    })
  })

  it("keeps the established display when a later patch says nothing", () => {
    const part = running({ verb: "write", target: "/tmp/report.html" })

    const patched = toMetadataPatchedToolPart(part, { metadata: { mode: "append" } })

    expect(patched.state.display.target).toBe("/tmp/report.html")
    expect(patched.state.metadata).toEqual({ mode: "append" })
  })

  it("carries the display onto a failed call, so a failure still says what it tried", () => {
    const part = running({ verb: "write", target: "/tmp/report.html" })

    const errored = toErroredToolPart(part, {}, { message: "permission denied", retryable: false })

    expect(errored.state.display.verb).toBe("write")
    expect(errored.state.display.target).toBe("/tmp/report.html")
  })

  it("lets a later patch override an earlier field", () => {
    const part = running({ verb: "write", summary: "starting" })

    const completed = toCompletedToolPart(part, {}, { display: { summary: "31.1 KB" }, output: "ok" })

    expect(completed.state.display.summary).toBe("31.1 KB")
  })
})

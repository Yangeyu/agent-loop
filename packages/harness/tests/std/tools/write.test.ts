import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAgentRegistry } from "@harness/agent/registry"
import { loadConfigFromEnv } from "@harness/config"
import { createRuntimeEvents } from "@harness/event/bus"
import { MemorySessionPersistence, Sessions } from "@harness/session"
import { createSkillRegistry } from "@harness/skill/registry"
import { WriteTool } from "@harness/std/tools/write"
import { createToolRegistry } from "@harness/tool/registry"
import type { ToolContext, ToolMetadata } from "@harness/types"

function createContext(): ToolContext {
  const events = createRuntimeEvents()
  return {
    config: loadConfigFromEnv({}),
    agent_registry: createAgentRegistry(),
    skill_registry: createSkillRegistry(),
    sessions: new Sessions(new MemorySessionPersistence(), events.state),
    tool_registry: createToolRegistry(),
    events,
    sessionID: "session-1",
    messageID: "message-1",
    agent: "lead",
    abort: new AbortController().signal,
    format: { type: "text" },
    messages: [],
    metadata: async () => {},
    executeTool: async () => ({ status: "error", error: { message: "not implemented", retryable: false } }),
  }
}

function metadataOf(result: { metadata?: ToolMetadata }) {
  return (result.metadata ?? {}) as Record<string, unknown>
}

describe("WriteTool", () => {
  it("creates the file and its parent directories on overwrite", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "nested", "deep", "report.html")

    const result = await WriteTool.execute({ filePath: target, content: "<!doctype html>" }, createContext())

    expect(readFileSync(target, "utf8")).toBe("<!doctype html>")
    expect(metadataOf(result).created).toBe(true)
    expect(metadataOf(result).mode).toBe("overwrite")
    expect(metadataOf(result).totalBytes).toBe(15)
  })

  it("appends across calls and reports the growing total", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "report.html")
    const ctx = createContext()

    await WriteTool.execute({ filePath: target, content: "<head>" }, ctx)
    const second = await WriteTool.execute({ filePath: target, content: "<body>", mode: "append" }, ctx)

    expect(readFileSync(target, "utf8")).toBe("<head><body>")
    expect(metadataOf(second).created).toBe(false)
    expect(metadataOf(second).bytesWritten).toBe(6)
    expect(metadataOf(second).totalBytes).toBe(12)
    expect(second.output).toContain("12 bytes")
  })

  it("counts bytes rather than characters for multibyte content", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "report.html")

    const result = await WriteTool.execute({ filePath: target, content: "洞察" }, createContext())

    expect(metadataOf(result).bytesWritten).toBe(6)
  })

  it("keeps the output to one line instead of echoing the content back", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "report.html")
    const content = "x".repeat(5000)

    const result = await WriteTool.execute({ filePath: target, content }, createContext())

    expect(result.output).not.toContain(content)
    expect(result.output.split("\n")).toHaveLength(1)
  })

  it("fails loudly when the path is a directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "write-"))
    const target = join(root, "adir")
    mkdirSync(target)

    const attempt = WriteTool.execute({ filePath: target, content: "x" }, createContext())

    await expect(attempt).rejects.toMatchObject({ info: { code: "write_not_a_file" } })
  })
})

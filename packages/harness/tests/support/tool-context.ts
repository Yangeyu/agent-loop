// A ToolContext wired to in-memory collaborators, for testing a tool in
// isolation. Overrides replace individual fields, so a test states only the
// collaborator it actually exercises.
import { loadConfigFromEnv } from "@harness/config"
import { createRuntimeEvents } from "@harness/event/bus"
import { MemorySessionPersistence, Sessions } from "@harness/session"
import type { ToolContext } from "@harness/types"

export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  const events = createRuntimeEvents()
  return {
    config: loadConfigFromEnv({}),
    sessions: new Sessions(new MemorySessionPersistence(), events.state),
    events,
    sessionID: "session-1",
    messageID: "message-1",
    agent: "lead",
    abort: new AbortController().signal,
    format: { type: "text" },
    messages: [],
    metadata: async () => {},
    executeTool: async () => ({ status: "error", error: { message: "not implemented", retryable: false } }),
    ...overrides,
  }
}

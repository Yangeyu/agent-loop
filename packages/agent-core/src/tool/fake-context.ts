// A ToolContext wired to in-memory collaborators, for exercising a tool without
// a loop around it. Overrides replace individual fields, so a caller states only
// the collaborator it actually uses.
//
// Ships with the package for the same reason createFakeModel does: the tool
// contract is public, and everyone building against it otherwise hand-rolls the
// same stub.
import { DEFAULT_CORE_CONFIG } from "@agent-core/config"
import { createRuntimeEvents } from "@agent-core/event/bus"
import { MemorySessionPersistence, Sessions } from "@agent-core/session"
import type { ToolContext } from "@agent-core/types"

export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  const events = createRuntimeEvents()
  return {
    config: DEFAULT_CORE_CONFIG,
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

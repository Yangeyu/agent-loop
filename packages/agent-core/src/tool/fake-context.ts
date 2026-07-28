/**
 * A ToolContext wired to in-memory collaborators, for exercising a tool without
 * a loop around it. Overrides replace individual fields, so a caller states only
 * the collaborator it uses. Ships with the package because the tool contract is
 * public: otherwise every consumer hand-rolls this same stub.
 */
import { DEFAULT_CORE_CONFIG } from "@agent-core/config"
import { createRuntimeEvents } from "@agent-core/event/bus"
import { MemorySessionPersistence, Sessions } from "@agent-core/session"
import type { ToolContext } from "@agent-core/types"

/**
 * Builds a ToolContext backed by in-memory sessions and a private event bus.
 *
 * @param overrides - fields to replace; state only the collaborator under test
 * @returns a context a tool's execute() can be called with directly
 */
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

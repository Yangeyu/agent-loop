// A ToolContext wired to in-memory collaborators, for testing a tool in
// isolation. Overrides replace individual fields, so a test states only the
// collaborator it actually exercises.
import { createAgentRegistry } from "@harness/agent/registry"
import { loadConfigFromEnv } from "@harness/config"
import { createRuntimeEvents } from "@harness/event/bus"
import { MemorySessionPersistence, Sessions } from "@harness/session"
import { createSkillRegistry } from "@harness/skill/registry"
import { createToolRegistry } from "@harness/tool/registry"
import type { ToolContext } from "@harness/types"
import { createWorkspace } from "@harness/workspace"

export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  const events = createRuntimeEvents()
  return {
    config: loadConfigFromEnv({}),
    agent_registry: createAgentRegistry(),
    skill_registry: createSkillRegistry(),
    sessions: new Sessions(new MemorySessionPersistence(), events.state),
    tool_registry: createToolRegistry(),
    events,
    workspace: createWorkspace(),
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

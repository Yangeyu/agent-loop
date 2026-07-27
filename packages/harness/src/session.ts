// runSession: start a turn loop from a new user message. Two things happen here
// that are not loop primitives — resolving an agent by name, and appending the
// message that gives the loop something to answer — which is why this is the
// orchestration layer's entry and runLoop is the kernel's.
import {
  createID,
  runLoop,
  type AgentDefinition,
  type EngineDeps,
  type ImageSource,
  type OutputFormat,
  type SessionInfo,
  type UserMessage,
} from "@agent-core"

/** Resolving an agent by name is a lookup the loop itself never performs. */
export type SessionDeps = EngineDeps & {
  agent_registry: { get(name: string): AgentDefinition; defaultAgent(): AgentDefinition }
}

/** A request to run a session turn-loop from a new user message. */
export type RunSessionInput = {
  sessionID: string
  text: string
  agent?: string
  format?: OutputFormat
  // Images supplied with the user message (e.g. a TUI `@` file or a ctrl+v
  // screenshot). The multimodal model sees these directly; see view-image
  // middleware (resolves file sources) and the image_url mapping.
  images?: ImageSource[]
  abort?: AbortSignal
}

/**
 * Appends a user message (text + images) to the session, emits session.start, and
 * drives the agent loop to completion.
 *
 * @param deps - the engine dependencies plus the agent registry
 * @param input - the session id, user text, and optional agent/format/images
 * @returns the session after the loop breaks
 */
export async function runSession(deps: SessionDeps, input: RunSessionInput): Promise<SessionInfo> {
  const sessions = deps.sessions
  const session = sessions.get(input.sessionID)
  const agent = deps.agent_registry.get(input.agent ?? deps.agent_registry.defaultAgent().name)
  const user: UserMessage = {
    id: createID(),
    role: "user",
    agent: agent.name,
    format: input.format ?? agent.format,
    time: { created: Date.now() },
  }

  sessions.appendMessage(input.sessionID, user)
  sessions.appendPart(input.sessionID, user.id, { id: createID(), type: "text", text: input.text })
  for (const source of input.images ?? []) {
    sessions.appendPart(input.sessionID, user.id, { id: createID(), type: "image", source })
  }

  deps.events.loop.emit({
    type: "session.start",
    sessionID: input.sessionID,
    rootID: session.rootID,
    agent: agent.name,
    text: input.text,
  })

  return runLoop(deps, { sessionID: input.sessionID, agent, abort: input.abort })
}

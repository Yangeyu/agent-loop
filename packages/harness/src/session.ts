/**
 * runSession: the orchestration layer's named entry into an agent run. It adds
 * the one step the engine leaves to its caller — resolving which registered
 * agent answers — and delegates to that agent's run().
 */
import type { Agent, ImageSource, OutputFormat, SessionInfo } from "@agent-core"

/** Resolving an agent by name is a lookup the engine itself never performs. */
export type SessionDeps = {
  agent_registry: { get(name: string): Agent; defaultAgent(): Agent }
}

/** A request to run a session turn-loop from a new user message. */
export type RunSessionInput = {
  sessionID: string
  text: string
  agent?: string
  format?: OutputFormat
  /**
   * Images supplied with the user message (a TUI `@` file, a pasted
   * screenshot). The multimodal model sees these directly; the view-image
   * middleware resolves local file sources before the call.
   */
  images?: ImageSource[]
  abort?: AbortSignal
}

/**
 * Resolves the named (or default) agent and runs it against the session.
 *
 * @param deps - the agent registry
 * @param input - the session id, user text, and optional agent/format/images
 * @returns the session after the loop breaks
 */
export async function runSession(deps: SessionDeps, input: RunSessionInput): Promise<SessionInfo> {
  const agent = input.agent ? deps.agent_registry.get(input.agent) : deps.agent_registry.defaultAgent()
  return agent.run({
    sessionID: input.sessionID,
    text: input.text,
    format: input.format,
    images: input.images,
    abort: input.abort,
  })
}

/**
 * The agent orchestration loop. Agent-agnostic: it resolves the agent blueprint
 * once per run, builds the loop-scoped middleware stack (the AgentRun), then
 * drives turns until a middleware-shaped outcome breaks. Delegation to a
 * subagent is just another runSession on a child session (see tool/task.ts).
 *
 * Lifecycle (this file is the authoritative ordering of the hook points):
 *
 *   runSession ── append user message ──► runLoop
 *     per step (one turn):
 *       TurnRecorder created (appends assistant message, emits turn.start)
 *       beforeTurn ──────────(gate stops)──► recorder.finish + outcome & return
 *       contributeSystem → transformMessages   (assembled input, after beforeTurn)
 *       runTurn:
 *         stream ─► tool dispatch (beforeToolCall → execute → afterToolCall / onToolError)
 *                ─► onTurnFinish ─► recorder terminal (exactly once)
 *       resolveOutcome ──────(break)────────► return ; else next step
 *
 * The loop emits only loop telemetry (session.start / turn.input / turn.outcome);
 * all session content flows through the Sessions aggregate, which emits the
 * state channel by itself.
 */
import type { AgentDefinition } from "@harness/agent/types"
import { createTurnContext, type EngineDeps, type TurnContext } from "@harness/core/context"
import { baseOutcome } from "@harness/core/outcome"
import { createTurnAbortSignal, resolveTurnExecutionPolicy } from "@harness/core/policy"
import { TurnRecorder } from "@harness/core/recorder"
import { runTurn } from "@harness/core/turn"
import type { TurnOutcome } from "@harness/hooks/types"
import { MiddlewareStack } from "@harness/hooks/stack"
import { toModelMessages } from "@harness/llm/message"
import {
  createID,
  type AssistantMessage,
  type ImageSource,
  type OutputFormat,
  type SessionInfo,
  type UserMessage,
} from "@harness/types"

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
 * @param deps - the engine dependencies (sessions, registries, events, config)
 * @param input - the session id, user text, and optional agent/format/images
 * @returns the session after the loop breaks
 */
export async function runSession(deps: EngineDeps, input: RunSessionInput): Promise<SessionInfo> {
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

/**
 * Drives the turn loop for an already-seeded session: builds the agent's
 * middleware stack once, then runs turns (beforeTurn gate → system/messages →
 * runTurn → resolveOutcome) until an outcome breaks. The reusable entry for
 * subagent delegation, which seeds the child session itself.
 *
 * @param deps - the engine dependencies
 * @param input - the session id, resolved agent blueprint, and optional abort
 * @returns the session after the loop breaks
 */
export async function runLoop(
  deps: EngineDeps,
  input: { sessionID: string; agent: AgentDefinition; abort?: AbortSignal },
): Promise<SessionInfo> {
  const sessions = deps.sessions
  const model = input.agent.model
  const stack = MiddlewareStack.build(input.agent.assemble().middleware)
  const rootAbort = input.abort ?? new AbortController().signal

  let step = 0
  while (true) {
    step += 1
    const session = sessions.get(input.sessionID)
    const user = resolveLastUserMessage(session)
    const policy = resolveTurnExecutionPolicy(deps.config, input.agent, session)
    const tools = [...(await deps.tool_registry.toolsForAgent(input.agent))]

    const assistant: AssistantMessage = {
      id: createID(),
      role: "assistant",
      parentID: user.id,
      agent: input.agent.name,
      model: { providerID: model.providerID, modelID: model.spec.id },
      time: { created: Date.now() },
    }

    const turnAbort = createTurnAbortSignal({ parent: rootAbort, timeoutMs: policy.timeout.turnTimeoutMs })
    const ctx = createTurnContext({
      deps,
      agent: input.agent,
      model,
      policy,
      sessionID: input.sessionID,
      rootID: session.rootID,
      user,
      messageID: assistant.id,
      tools,
      step,
      abort: turnAbort.signal,
    })

    // Appends the assistant message and emits turn.start; from here the
    // recorder owns the turn's accumulation and terminal transition.
    const recorder = new TurnRecorder({
      sessions,
      loop: deps.events.loop,
      sessionID: input.sessionID,
      rootID: session.rootID,
      agent: input.agent.name,
      step,
      assistant,
    })

    try {
      const gate = await stack.beforeTurn(ctx)
      if (!gate.proceed) {
        recorder.finish("stop")
        if (gate.note) recorder.appendNote(gate.note)
        emitTurnOutcome(ctx, { kind: "break", reason: gate.reason })
        return sessions.get(input.sessionID)
      }

      const system = await stack.contributeSystem(ctx)
      const messages = await stack.transformMessages(ctx, toModelMessages(sessions.get(input.sessionID)))

      deps.events.loop.emit({
        type: "turn.input",
        sessionID: input.sessionID,
        rootID: session.rootID,
        agent: input.agent.name,
        messageID: assistant.id,
        step,
        system,
        tools: tools.map((tool) => tool.id),
        messageCount: sessions.get(input.sessionID).messages.length,
      })

      const { sawToolCall } = await runTurn(ctx, stack, recorder, { system, messages })
      const outcome = await stack.resolveOutcome(ctx, baseOutcome(ctx, sawToolCall))

      if (outcome.kind === "break" && outcome.note) recorder.appendNote(outcome.note)
      emitTurnOutcome(ctx, outcome)

      if (outcome.kind === "break") return sessions.get(input.sessionID)
    } finally {
      turnAbort.dispose()
    }
  }
}

function emitTurnOutcome(ctx: TurnContext, outcome: TurnOutcome) {
  ctx.events.loop.emit({
    type: "turn.outcome",
    sessionID: ctx.sessionID,
    rootID: ctx.rootID,
    agent: ctx.agent.name,
    messageID: ctx.messageID,
    step: ctx.step,
    outcome: outcome.kind,
    reason: outcome.reason,
  })
}

function resolveLastUserMessage(session: SessionInfo): UserMessage {
  const user = [...session.messages].reverse().find((message) => message.role === "user")
  if (!user) throw new Error("No user message found")
  return user
}

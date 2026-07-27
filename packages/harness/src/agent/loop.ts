/**
 * The agent orchestration loop. Agent-agnostic: it resolves the agent blueprint
 * once per run, builds the loop-scoped middleware stack (the AgentRun), then
 * drives turns until a middleware-shaped outcome breaks. Delegation to a
 * subagent is just another runSession on a child session (see tool/task.ts).
 *
 * Lifecycle (this file is the authoritative ordering of the hook points):
 *
 *   runSession ── append user message ──► runLoop
 *     beforeRun
 *     per step (one turn):
 *       TurnRecorder created (appends assistant message, emits turn.start)
 *       beforeTurn ──────────(gate stops)──► recorder.finish & return
 *       beforeModelCall                        (system + messages draft)
 *       runTurn:
 *         wrapModelCall( stream ) ─► tool batch (beforeToolCall → execute → afterToolCall)
 *                                 ─► returns the still-open finishReason on a clean finish
 *       afterTurn ─► apply terminal (exactly once) ─► (break) return ; else next step
 *     afterRun (in a finally)
 *
 * The loop itself emits only session.start; turn-scoped telemetry (turn.start /
 * turn.phase / turn.end) is the recorder's, and all session content flows
 * through the Sessions aggregate, which emits the state channel by itself.
 */
import type { AgentDefinition } from "@harness/agent/blueprint"
import { createRunContext, createTurnContext, type EngineDeps } from "@harness/agent/context"
import { baseOutcome } from "@harness/agent/outcome"
import { createTurnAbortSignal, resolveTurnExecutionPolicy } from "@harness/agent/policy"
import { TurnRecorder } from "@harness/agent/recorder"
import { runTurn } from "@harness/agent/turn"
import { MiddlewareStack, type TurnOutcomeReason } from "@harness/agent/hooks"
import { toModelMessages } from "@harness/llm/message"
import {
  createID,
  type AssistantMessage,
  type ImageSource,
  type OutputFormat,
  type SessionInfo,
  type UserMessage,
} from "@harness/types"

/** Resolving an agent by name is a lookup the loop itself never performs. */
export type SessionDeps = EngineDeps & { agent_registry: { get(name: string): AgentDefinition; defaultAgent(): AgentDefinition } }

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
  const run = createRunContext({ deps, agent: input.agent, model, sessionID: input.sessionID, abort: rootAbort })

  await stack.beforeRun(run)

  let step = 0
  let reason: TurnOutcomeReason = "completed_without_output"

  try {
    while (true) {
      step += 1
      const session = sessions.get(input.sessionID)
      const user = resolveLastUserMessage(session)
      const policy = resolveTurnExecutionPolicy(deps.config, input.agent, session)

      const assistant: AssistantMessage = {
        id: createID(),
        role: "assistant",
        parentID: user.id,
        agent: input.agent.name,
        model: { providerID: model.providerID, modelID: model.spec.id },
        time: { created: Date.now() },
      }

      const turnAbort = createTurnAbortSignal({ parent: rootAbort, timeoutMs: policy.timeout.turnTimeoutMs })

      // Appends the assistant message and emits turn.start; from here the
      // recorder owns the turn's accumulation and terminal transition. It comes
      // before the context because the context borrows its activity emitter —
      // turn-scoped loop telemetry has exactly one owner.
      const recorder = new TurnRecorder({
        sessions,
        loop: deps.events.loop,
        sessionID: input.sessionID,
        rootID: session.rootID,
        agent: input.agent.name,
        step,
        maxSteps: policy.budget.maxAgentSteps,
        assistant,
      })

      const ctx = createTurnContext({
        run,
        deps,
        policy,
        user,
        messageID: assistant.id,
        tools: input.agent.tools,
        step,
        abort: turnAbort.signal,
        openActivity: (activity) => recorder.openActivity(activity),
      })

      try {
        const gate = await stack.beforeTurn(ctx)
        if (!gate.proceed) {
          reason = gate.reason
          recorder.finish("stop")
          if (gate.note) recorder.appendNote(gate.note)
          return sessions.get(input.sessionID)
        }

        // The engine seeds the draft with the agent's own instructions, so an
        // agent with zero middleware still speaks its blueprint; middleware then
        // wraps/extends the draft (base prompt, skills, structured output, …).
        const draft = await stack.beforeModelCall(ctx, {
          system: [...input.agent.instructions],
          messages: toModelMessages(sessions.get(input.sessionID)),
        })

        const { sawToolCall, finishReason } = await runTurn(ctx, stack, recorder, draft)

        // One judgment per turn: the stack sees how the turn ended and settles the
        // terminal (open only on a clean finish) and the loop continuation together.
        const judgment = await stack.afterTurn(ctx, {
          finish: {
            finishReason,
            text: sessions.messageText(input.sessionID, assistant.id, { includeSynthetic: false }),
          },
          terminal: finishReason !== undefined ? { ok: true } : undefined,
          outcome: baseOutcome(ctx, sawToolCall),
        })

        let outcome = judgment.outcome
        if (finishReason !== undefined) {
          const terminal = judgment.terminal ?? { ok: true }
          if (terminal.ok) {
            recorder.finish(terminal.finishReason ?? finishReason, terminal.structured)
          } else {
            recorder.fail(terminal.error)
            // A failed terminal must not let the loop keep going on a stale
            // continue: default to breaking as an assistant error.
            if (outcome.kind === "continue") outcome = { kind: "break", reason: "assistant_error" }
          }
        }

        reason = outcome.reason
        if (outcome.kind === "break" && outcome.note) recorder.appendNote(outcome.note)
        if (outcome.kind === "break") return sessions.get(input.sessionID)
      } finally {
        turnAbort.dispose()
      }
    }
  } finally {
    await stack.afterRun(run, { steps: step, reason })
  }
}

function resolveLastUserMessage(session: SessionInfo): UserMessage {
  const user = [...session.messages].reverse().find((message) => message.role === "user")
  if (!user) throw new Error("No user message found")
  return user
}

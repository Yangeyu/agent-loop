/**
 * The agent loop. Agent-agnostic: it resolves the agent blueprint once per
 * run, builds the loop-scoped middleware stack, then drives steps until a
 * middleware-shaped outcome breaks.
 *
 * Lifecycle (this file is the authoritative ordering of the hook points):
 *
 *   caller ── append user message ──► runLoop
 *     beforeRun
 *     per step:
 *       StepRecorder created (appends assistant message, emits step.start)
 *       beforeStep ──────────(gate stops)──► recorder.finish & return
 *       beforeModelCall                        (system + messages draft)
 *       runStep:
 *         wrapModelCall( stream ) ─► tool batch (beforeToolCall → execute → afterToolCall)
 *                                 ─► returns the still-open finishReason on a clean finish
 *       afterStep ─► apply terminal (exactly once) ─► (break) return ; else next step
 *     afterRun (in a finally)
 *
 * The loop itself emits only session.start; step-scoped telemetry (step.start /
 * step.phase / step.end) is the recorder's, and all session content flows
 * through the Sessions aggregate, which emits the state channel by itself.
 */
import type { AgentDefinition } from "@agent-core/agent"
import type { EngineDeps } from "@agent-core/context"
import { createRunContext, createStepContext, type StepContext } from "@agent-core/engine/context"
import { createStepAbortSignal, resolveStepExecutionPolicy } from "@agent-core/policy"
import { openActivity, StepRecorder } from "@agent-core/engine/recorder"
import { runStep } from "@agent-core/engine/step"
import { MiddlewareStack } from "@agent-core/engine/stack"
import type { StepOutcome, StepOutcomeReason } from "@agent-core/hooks"
import { toModelMessages } from "@agent-core/llm/message"
import { createID, type AssistantMessage, type SessionInfo, type UserMessage } from "@agent-core/model"

/**
 * Drives the step loop for an already-seeded session: builds the agent's
 * middleware stack once, then runs steps until an outcome breaks. Callers
 * append the run's user message before entering.
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
  // The run-boundary activity emitter: same event, no messageID — a consumer
  // renders these at run level. Inside a step the recorder's emitter shadows it.
  const envelope = { sessionID: input.sessionID, rootID: sessions.get(input.sessionID).rootID, agent: input.agent.name }
  const run = createRunContext({
    deps,
    agent: input.agent,
    model,
    sessionID: input.sessionID,
    abort: rootAbort,
    openActivity: (activity) => openActivity(deps.events.loop, envelope, activity),
  })

  await stack.beforeRun(run)

  let step = 0
  let reason: StepOutcomeReason = "completed_without_output"

  try {
    while (true) {
      step += 1
      const session = sessions.get(input.sessionID)
      const user = resolveLastUserMessage(session)
      const policy = resolveStepExecutionPolicy(deps.config, input.agent, session)

      const assistant: AssistantMessage = {
        id: createID(),
        role: "assistant",
        parentID: user.id,
        agent: input.agent.name,
        model: { providerID: model.providerID, modelID: model.spec.id },
        time: { created: Date.now() },
      }

      const stepAbort = createStepAbortSignal({ parent: rootAbort, timeoutMs: policy.timeout.stepTimeoutMs })

      // Appends the assistant message and emits step.start; from here the
      // recorder owns the step's accumulation and terminal transition. It comes
      // before the context because the context borrows its activity emitter —
      // step-scoped loop telemetry has exactly one owner.
      const recorder = new StepRecorder({
        sessions,
        loop: deps.events.loop,
        sessionID: input.sessionID,
        rootID: session.rootID,
        agent: input.agent.name,
        step,
        maxSteps: policy.budget.maxAgentSteps,
        assistant,
      })

      const ctx = createStepContext({
        run,
        deps,
        policy,
        user,
        messageID: assistant.id,
        tools: input.agent.tools,
        step,
        abort: stepAbort.signal,
        openActivity: (activity) => recorder.openActivity(activity),
      })

      try {
        const gate = await stack.beforeStep(ctx)
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

        const { sawToolCall, finishReason } = await runStep(ctx, stack, recorder, draft)

        // One judgment per step: the stack sees how the step ended and settles the
        // terminal (open only on a clean finish) and the loop continuation together.
        const judgment = await stack.afterStep(ctx, {
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
        stepAbort.dispose()
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

// The base step outcome, derived purely from the assistant message state and
// whether tool calls were seen. Policy-driven overrides (step budget,
// structured output) are middleware on afterStep.
function baseOutcome(ctx: StepContext, sawToolCall: boolean): StepOutcome {
  const session = ctx.sessions.get(ctx.sessionID)
  const assistant = session.messages.find((message) => message.id === ctx.messageID)
  const hasFinalText = assistant
    ? ctx.sessions.messageText(ctx.sessionID, assistant.id, { includeSynthetic: false }).trim().length > 0
    : false

  if (assistant?.role === "assistant" && assistant.error) return { kind: "break", reason: "assistant_error" }
  if (sawToolCall) return { kind: "continue", reason: "tool_calls" }
  if (assistant && !hasFinalText) return { kind: "continue", reason: "empty_assistant" }
  if (hasFinalText) return { kind: "break", reason: "final_text" }
  return { kind: "break", reason: "completed_without_output" }
}

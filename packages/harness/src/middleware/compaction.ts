// Proactive compaction: when the estimated context exceeds the configured
// threshold, summarize prior history via the agent's model (direct call,
// bypassing the stack to avoid re-entrancy), persist the summary, and rebuild
// the model messages from the compacted session.
import type { ModelCaller } from "@harness/agent/model"
import type { AgentDefinition } from "@harness/agent/types"
import type { LLMInput, ModelMessage } from "@harness/llm/types"
import type { MiddlewareFactory } from "@harness/hooks/types"
import { estimateModelTokens } from "@harness/middleware/token-estimate"
import { toModelMessages } from "@harness/session/model-message"
import {
  createID,
  type AssistantMessage,
  type CompactionPart,
  type SessionInfo,
  type UserMessage,
} from "@harness/types"

const SUMMARY_SYSTEM = [
  "You are compacting a long conversation to fit a smaller context window.",
  "Produce a concise summary that preserves key facts, decisions, file paths,",
  "tool results, and open tasks. Output only the summary text.",
].join(" ")

export const compaction: MiddlewareFactory = () => ({
  name: "compaction",

  async transformMessages(ctx, messages) {
    const estimate = estimateModelTokens(ctx.system, messages)
    if (estimate < ctx.config.compaction_token_threshold) return messages

    const session = ctx.session_store.get(ctx.sessionID)
    const latestUser = lastUserMessage(session)
    if (!latestUser) return messages

    const summary = await summarize({
      llm: ctx.llm,
      agent: ctx.agent,
      session,
      priorMessages: messages,
      abort: ctx.abort,
      sessionID: ctx.sessionID,
    })
    if (!summary) return messages

    const compactionPart: CompactionPart = { id: createID(), type: "compaction", summary }
    ctx.events.emit({ type: "compaction", sessionID: ctx.sessionID, summary })
    ctx.session_store.replaceState({
      sessionID: ctx.sessionID,
      messages: [latestUser],
      parts: buildCompactedParts(session, compactionPart, latestUser.id),
    })

    return toModelMessages(ctx.session_store.get(ctx.sessionID))
  },
})

async function summarize(input: {
  llm: ModelCaller
  agent: AgentDefinition
  session: SessionInfo
  priorMessages: ModelMessage[]
  abort: AbortSignal
  sessionID: string
}): Promise<string> {
  const synthetic = {
    sessionID: input.sessionID,
    agent: input.agent.name,
    model: input.llm.providerModel,
    time: { created: Date.now() },
  }
  const user: UserMessage = { id: createID(), role: "user", ...synthetic }
  const assistant: AssistantMessage = { id: createID(), role: "assistant", parentID: user.id, ...synthetic }

  const llmInput: LLMInput = {
    session: input.session,
    user,
    assistant,
    agent: input.agent,
    system: [SUMMARY_SYSTEM],
    messages: input.priorMessages,
    tools: [],
    abort: input.abort,
  }

  let text = ""
  for await (const chunk of input.llm.stream(llmInput).fullStream) {
    if (chunk.type === "text-delta") text += chunk.textDelta
    else if (chunk.type === "error") break
  }
  return text.trim()
}

function lastUserMessage(session: SessionInfo): UserMessage | undefined {
  return [...session.messages].reverse().find((message) => message.role === "user") as UserMessage | undefined
}

function buildCompactedParts(session: SessionInfo, compactionPart: CompactionPart, latestUserID: string) {
  const nextParts: Record<string, SessionInfo["parts"][string]> = {
    [latestUserID]: [compactionPart],
  }

  const latestUserParts = session.parts[latestUserID]
  if (latestUserParts?.length) {
    nextParts[latestUserID] = [compactionPart, ...latestUserParts]
  }

  return nextParts
}

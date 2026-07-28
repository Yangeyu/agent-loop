import type { AgentRegistry, HarnessAgent } from "@harness/registry"
import type { Config } from "@harness/config"
import type { Sessions } from "@agent-core"
import type { PromptContributor } from "@harness/prompt"
import { defineTool } from "@agent-core"
import type { AssistantMessage, ToolDefinition } from "@agent-core"
import { z } from "zod"

/** What delegation needs: who may be delegated to, and how deep it may go. */
export type TaskDeps = { agents: AgentRegistry; config: Config }

/**
 * Prompt axis: gives `subagent_type` a real domain. It ships with the tool
 * because `mode === "subagent"` is one admission rule, and stating it twice in
 * two files is how the advertised set and the accepted set drift apart.
 */
export function createSubagentList(deps: { agents: AgentRegistry }): PromptContributor {
  return () => {
    const subagents = deps.agents.list().filter(isDelegable)
    if (subagents.length === 0) return undefined

    return {
      slot: "capability",
      text: [
        "Delegate work to these subagents via the task tool's subagent_type argument:",
        "<available_subagents>",
        ...subagents.map((agent) => `- ${agent.definition.name}: ${agent.definition.description ?? "Specialist subagent"}`),
        "</available_subagents>",
      ].join("\n"),
    }
  }
}

function isDelegable(agent: HarnessAgent) {
  return agent.mode === "subagent"
}

// Delegation depth is measured by walking the session tree, which only this tool
// does: a session's parent chain is a fact about the store, but "how deep may we
// delegate" is a fact about delegation. It lives with the tool that asks.
function resolveSessionDepth(sessions: Sessions, sessionID: string) {
  let depth = 0
  let current = sessions.get(sessionID)

  while (current.parentID) {
    depth += 1
    current = sessions.get(current.parentID)
  }

  return depth
}

const BaseTaskParameters = {
  description: z.string().trim().min(3).max(120)
    .describe("A high-level explanation of the subtask"),
  prompt: z.string().trim().min(1)
    .describe("The detailed instructions for the subagent"),
  subagent_type: z.string().trim().min(1)
    .describe("The name of the agent to delegate to"),
}

export const TaskParameters = z.object(BaseTaskParameters)
export const TaskResumeParameters = z.object({
  ...BaseTaskParameters,
  task_id: z.string().trim().min(1)
    .describe("The ID of the session to resume"),
})

export type TaskArgs = z.infer<typeof TaskParameters>
export type TaskResumeArgs = z.infer<typeof TaskResumeParameters>

/** Builds the task tool: starts a subagent in a fresh child session. */
export function createTaskTool(deps: TaskDeps): ToolDefinition<TaskArgs> {
  return defineDelegationTool(deps, {
    id: "task",
    description:
      "Start a new subagent in a new child session. Always use this to begin delegated work and do not pass any previous task id.",
    parameters: TaskParameters,
    resume: false,
  })
}

/** Builds the task_resume tool: continues a child session this session started. */
export function createTaskResumeTool(deps: TaskDeps): ToolDefinition<TaskResumeArgs> {
  return defineDelegationTool(deps, {
    id: "task_resume",
    description:
      "Resume an existing delegated subagent using a previously returned task_id from the current parent session. Use this only when you intentionally continue that exact child session.",
    parameters: TaskResumeParameters,
    resume: true,
  })
}

function defineDelegationTool<P extends z.ZodTypeAny>(deps: TaskDeps, input: {
  id: string
  description: string
  parameters: P
  resume: boolean
}) {
  return defineTool({
    id: input.id,
    description: input.description,
    parameters: input.parameters,
    describe(args) {
      // The delegate and what it was asked for are both arguments, so the row
      // names the subagent from the moment it appears rather than once the
      // child session exists.
      return { verb: "subagent", target: args.subagent_type, summary: args.description }
    },
    mapError({ error, toolID }) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("Session not found") || message.includes("does not belong to session")) {
        return {
          message: `The ${toolID} tool failed: ${message}`,
          retryable: false,
          code: "task_invalid_resume",
        }
      }

      if (message.includes("not available for task delegation")) {
        return {
          message: `The ${toolID} tool failed: ${message}`,
          retryable: false,
          code: "task_invalid_delegate",
        }
      }

      if (message.includes("Subagent depth limit reached")) {
        return {
          message: `The ${toolID} tool failed: ${message}`,
          retryable: false,
          code: "task_depth_exceeded",
        }
      }

      return {
        message: `The ${toolID} tool failed: ${message}`,
        retryable: false,
        code: "tool_execution_failed",
      }
    },
    async execute(args, ctx) {
      const agent = deps.agents.list().find((candidate) => candidate.definition.name === args.subagent_type)
      if (!agent || !isDelegable(agent)) {
        throw new Error(`Agent ${args.subagent_type} is not available for task delegation`)
      }

      const sessions = ctx.sessions
      const maxDepth = deps.config.subagent_max_depth
      const nextDepth = resolveSessionDepth(sessions, ctx.sessionID) + 1
      if (nextDepth > maxDepth) {
        throw new Error(`Subagent depth limit reached: attempted depth ${nextDepth}, max ${maxDepth}`)
      }

      const child = input.resume
        ? getChildSession({
            taskId: (args as TaskResumeArgs).task_id,
            parentSessionId: ctx.sessionID,
            sessions,
          })
        : createChildSession({
            parentSessionId: ctx.sessionID,
            description: args.description,
            agentName: agent.definition.name,
            sessions,
          })

      // Re-checked on the child itself: a resumed session's depth is whatever
      // its own parent chain says, not one more than the caller's.
      const childDepth = resolveSessionDepth(sessions, child.id)
      if (childDepth > maxDepth) {
        throw new Error(`Subagent depth limit reached: attempted depth ${childDepth}, max ${maxDepth}`)
      }

      // The subagent runs on the same store and bus as the parent — registry
      // admission guarantees it — so concurrent delegation is safe without the
      // two sessions coordinating.
      await agent.run({
        sessionID: child.id,
        text: args.prompt,
        format: ctx.format,
        abort: ctx.abort,
      })

      const completedChild = sessions.get(child.id)

      const lastAssistant = [...completedChild.messages].reverse().find((message) => message.role === "assistant") as
        | AssistantMessage
        | undefined
      const result = extractTaskResult({
        childSessionId: completedChild.id,
        lastAssistant,
        sessions,
      })

      return {
        output: formatTaskToolOutput({
          taskId: completedChild.id,
          agentName: agent.definition.name,
          result: result.text,
        }),
      }
    },
  })
}

function extractTaskResult(input: {
  childSessionId: string
  lastAssistant: AssistantMessage | undefined
  sessions: Sessions
}) {
  const finalText = input.lastAssistant
    ? input.sessions.messageText(input.childSessionId, input.lastAssistant.id, { includeSynthetic: false }).trim()
    : ""
  const synthesizedText = input.lastAssistant
    ? input.sessions.messageText(input.childSessionId, input.lastAssistant.id).trim()
    : ""
  const structuredText =
    input.lastAssistant?.structured !== undefined
      ? JSON.stringify(input.lastAssistant.structured, null, 2)
      : ""
  const text = structuredText || finalText || synthesizedText || "Subagent stopped without final answer"
  return { text }
}

function formatTaskToolOutput(input: {
  taskId: string
  agentName: string
  result: string
}) {
  return [
    `task_id: ${input.taskId}`,
    `agent: ${input.agentName}`,
    "",
    "<task_result>",
    input.result,
    "</task_result>",
  ].join("\n")
}

function getChildSession(input: {
  taskId: string
  parentSessionId: string
  sessions: Sessions
}) {
  const session = input.sessions.get(input.taskId)
  if (session.parentID !== input.parentSessionId) {
    throw new Error(`Task ${input.taskId} does not belong to session ${input.parentSessionId}`)
  }
  return session
}

function createChildSession(input: {
  parentSessionId: string
  description: string
  agentName: string
  sessions: Sessions
}) {
  return input.sessions.create({
    parentID: input.parentSessionId,
    title: `${input.description} (@${input.agentName} subagent)`,
  })
}


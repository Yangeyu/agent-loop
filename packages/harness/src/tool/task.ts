import { getDelegationDepthInfo, resolveSessionDepth } from "@harness/core/policy"
import { runSession } from "@harness/core/loop"
import type { Sessions } from "@harness/session"
import { defineTool } from "@harness/tool/tool"
import type {
  AssistantMessage,
  MessagePart,
  ToolPart,
  ToolDefinition,
} from "@harness/types"
import { z } from "zod"

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

export const TaskTool: ToolDefinition<TaskArgs> = createTaskTool({
  id: "task",
  description:
    "Start a new subagent in a new child session. Always use this to begin delegated work and do not pass any previous task id.",
  parameters: TaskParameters,
  resume: false,
})

export const TaskResumeTool: ToolDefinition<TaskResumeArgs> = createTaskTool({
  id: "task_resume",
  description:
    "Resume an existing delegated subagent using a previously returned task_id from the current parent session. Use this only when you intentionally continue that exact child session.",
  parameters: TaskResumeParameters,
  resume: true,
})

function createTaskTool<P extends z.ZodTypeAny>(input: {
  id: string
  description: string
  parameters: P
  resume: boolean
}) {
  return defineTool({
    id: input.id,
    description: input.description,
    parameters: input.parameters,
    beforeExecute({ args }) {
      return {
        title: args.description,
        metadata: {
          subagentName: args.subagent_type,
          resume: input.resume,
        },
      }
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
    normalizeMetadata({ metadata, ctx }) {
      return {
        ...(metadata ?? {}),
        parentSessionId: ctx.sessionID,
      }
    },
    async execute(args, ctx) {
      const agent = ctx.agent_registry.list().find((candidate) => candidate.name === args.subagent_type)
      if (!agent || agent.mode !== "subagent") {
        throw new Error(`Agent ${args.subagent_type} is not available for task delegation`)
      }

      const sessions = ctx.sessions
      const depth = getDelegationDepthInfo({
        sessions,
        sessionID: ctx.sessionID,
        maxDepth: ctx.config.subagent_max_depth,
      })

      if (!depth.allowed) {
        ctx.events.loop.emit({
          type: "budget.hit",
          sessionID: ctx.sessionID,
          rootID: sessions.get(ctx.sessionID).rootID,
          agent: ctx.agent,
          budget: "subagent_depth",
          detail: `Subagent depth limit reached at depth ${depth.nextDepth}`,
          limit: depth.maxDepth,
          used: depth.nextDepth,
        })
        throw new Error(`Subagent depth limit reached: attempted depth ${depth.nextDepth}, max ${depth.maxDepth}`)
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
            agentName: agent.name,
            sessions,
          })

      const childDepth = resolveSessionDepth(sessions, child.id)
      if (childDepth > ctx.config.subagent_max_depth) {
        ctx.events.loop.emit({
          type: "budget.hit",
          sessionID: ctx.sessionID,
          rootID: sessions.get(ctx.sessionID).rootID,
          agent: ctx.agent,
          budget: "subagent_depth",
          detail: `Subagent depth limit reached at depth ${childDepth}`,
          limit: ctx.config.subagent_max_depth,
          used: childDepth,
        })
        throw new Error(`Subagent depth limit reached: attempted depth ${childDepth}, max ${ctx.config.subagent_max_depth}`)
      }

      await ctx.metadata({
        title: args.description,
        metadata: {
          taskId: child.id,
          sessionId: child.id,
          parentSessionId: ctx.sessionID,
          agentName: agent.name,
          subagentName: agent.name,
          resume: input.resume,
          completed: false,
        },
      })

      await runSession({
        config: ctx.config,
        agent_registry: ctx.agent_registry,
        skill_registry: ctx.skill_registry,
        sessions: ctx.sessions,
        tool_registry: ctx.tool_registry,
        events: ctx.events,
      }, {
        sessionID: child.id,
        text: args.prompt,
        agent: agent.name,
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
        title: args.description,
        output: formatTaskToolOutput({
          taskId: completedChild.id,
          agentName: agent.name,
          result: result.text,
        }),
        metadata: {
          taskId: completedChild.id,
          sessionId: completedChild.id,
          parentSessionId: ctx.sessionID,
          agentName: agent.name,
          subagentName: agent.name,
          resume: input.resume,
          completed: lastAssistant?.time.completed !== undefined,
        },
      }
    },
  })
}

function extractTaskResult(input: {
  childSessionId: string
  lastAssistant: AssistantMessage | undefined
  sessions: Sessions
}) {
  const toolResult = input.lastAssistant
    ? extractDeliverableFromToolParts(input.sessions.parts(input.childSessionId, input.lastAssistant.id))
    : undefined
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
  const text = toolResult || structuredText || finalText || synthesizedText || "Subagent stopped without final answer"
  return { text }
}

function extractDeliverableFromToolParts(parts: readonly MessagePart[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (!part || part.type !== "tool") continue
    if (part.state.status !== "completed") continue

    const reportPath = readReportPath(part)
    if (reportPath) return reportPath
  }

  return undefined
}

function readReportPath(part: ToolPart) {
  const reportPath = part.state.metadata?.reportPath
  return typeof reportPath === "string" && reportPath.trim().length > 0 ? reportPath : undefined
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


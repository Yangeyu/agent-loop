// Folds the two harness event channels into the TUI's flat trace timeline.
// Entirely self-contained: session lineage comes from session.created /
// session.start events and content joins on partID — the folder never reads
// the session store.
import type { LoopEvent, StateEvent } from "@harness"
import type { Setter } from "solid-js"
import type { TraceEntry } from "@tui/types"
import { COLORS, asRecord, preview, safeJson, shouldCollapse } from "@tui/theme"

function summarizeToolInput(tool: string, input: unknown) {
  if (tool === "task") {
    const data = asRecord(input)
    const agent = typeof data?.subagent_type === "string" ? data.subagent_type : undefined
    const description = typeof data?.description === "string" ? data.description : undefined
    return preview([description, agent ? `agent ${agent}` : undefined].filter(Boolean).join(" · "), 180)
  }

  return preview(input, 180)
}

function summarizeToolOutput(tool: string, output: unknown) {
  if (tool === "task") {
    const text = typeof output === "string" ? output : safeJson(output)
    const taskID = matchField(text, /task_id[:=]\s*([^\s,]+)/i)
    const agent = matchField(text, /agent[:=]\s*([^\s,]+)/i)
    const result = extractTaskResult(text)
    const parts = [
      agent ? `agent ${agent}` : undefined,
      taskID ? `task ${taskID}` : undefined,
      result,
    ].filter(Boolean)
    return preview(parts.join(" · "), 220)
  }

  return preview(output, 220)
}

function extractTaskResult(text: string) {
  const marker = text.match(/<task_result>([\s\S]*)$/i)
  if (!marker) return preview(text, 180)
  return preview(marker[1].trim(), 180)
}

function matchField(text: string, pattern: RegExp) {
  const match = text.match(pattern)
  return match?.[1]?.trim()
}

function formatTraceToolLabel(tool: string, args: unknown) {
  if (tool !== "task") return tool
  const record = asRecord(args)
  const subagent = typeof record?.subagent_type === "string" ? record.subagent_type : "subagent"
  return `subagent(${subagent})`
}

/** The trace folder: subscribe `handleState` / `handleLoop` to the runtime bus. */
export type TraceFolder = {
  handleState(event: StateEvent): void
  handleLoop(event: LoopEvent): void
}

/**
 * Creates the trace folder feeding the transcript signal. All lineage and
 * content bookkeeping is internal; entries carry rootID/topLevel so the view
 * can scope and style without further lookups.
 *
 * @param input.createTraceID - id factory for new entries
 * @param input.setTraceEntries - the transcript signal setter
 * @returns handlers for the state and loop channels
 */
export function createTraceFolder(input: {
  createTraceID: () => string
  setTraceEntries: Setter<TraceEntry[]>
}): TraceFolder {
  // sessionID → display path (agent chain), parent path + this session's agent.
  const sessionPaths = new Map<string, string[]>()
  // sessionID → parentID, from session.created (arrives before any content).
  const sessionParents = new Map<string, string | undefined>()
  // messageID → role/agent, so part events know whose content they carry.
  const messages = new Map<string, { role: "user" | "assistant"; agent: string }>()
  // partID → entryID for streaming text/reasoning and tool parts.
  const entryByPart = new Map<string, string>()

  const appendEntry = (entry: TraceEntry) => {
    input.setTraceEntries((current) => [...current, entry])
  }

  const updateEntry = (entryID: string, updater: (entry: TraceEntry) => TraceEntry) => {
    input.setTraceEntries((current) => current.map((entry) => (entry.id === entryID ? updater(entry) : entry)))
  }

  const pathFor = (sessionID: string, fallbackAgent?: string) => {
    const existing = sessionPaths.get(sessionID)
    if (existing) return existing
    return fallbackAgent ? [fallbackAgent] : []
  }

  const baseEntry = (event: { sessionID: string; rootID: string }) => ({
    sessionID: event.sessionID,
    rootID: event.rootID,
    topLevel: event.sessionID === event.rootID,
  })

  const handleLoop = (event: LoopEvent) => {
    if (event.type === "session.start") {
      const parentID = sessionParents.get(event.sessionID)
      const parentPath = parentID ? sessionPaths.get(parentID) ?? [] : []
      const path = [...parentPath, event.agent]
      sessionPaths.set(event.sessionID, path)

      appendEntry({
        id: input.createTraceID(),
        ...baseEntry(event),
        kind: "user",
        title: `${path.join(" > ")} > user`,
        text: event.text,
        color: COLORS.accent,
      })
      return
    }

    if (event.type === "turn.end" && event.reason === "error" && event.error) {
      appendEntry({
        id: input.createTraceID(),
        ...baseEntry(event),
        kind: "error",
        title: `${pathFor(event.sessionID, event.agent).join(" > ")} > error`,
        text: preview(event.error, 220),
        detail: shouldCollapse(event.error, 220) ? event.error : undefined,
        color: COLORS.danger,
        status: "Execution failed",
      })
    }
  }

  const handleState = (event: StateEvent) => {
    if (event.type === "session.created") {
      sessionParents.set(event.session.id, event.session.parentID)
      return
    }

    if (event.type === "message.created") {
      messages.set(event.message.id, { role: event.message.role, agent: event.message.agent })
      return
    }

    if (event.type === "message.updated") {
      if (event.message.role === "assistant" && event.message.structured !== undefined) {
        appendEntry({
          id: input.createTraceID(),
          ...baseEntry(event),
          kind: "result",
          title: `${pathFor(event.sessionID).join(" > ")} > structured`,
          text: preview(event.message.structured, 220),
          color: COLORS.info,
          status: "Structured output",
        })
      }
      return
    }

    if (event.type === "part.created") {
      const message = messages.get(event.messageID)
      if (message?.role !== "assistant") return

      const path = pathFor(event.sessionID, message.agent)
      const topLevel = event.sessionID === event.rootID

      if (event.part.type === "tool") {
        const entryID = input.createTraceID()
        entryByPart.set(event.part.id, entryID)
        appendEntry({
          id: entryID,
          ...baseEntry(event),
          kind: "tool",
          title: `${path.join(" > ")} > ${formatTraceToolLabel(event.part.toolName, event.part.state.input)}`,
          text: summarizeToolInput(event.part.toolName, event.part.state.input),
          detail: shouldCollapse(safeJson(event.part.state.input), 220) ? safeJson(event.part.state.input) : undefined,
          color: COLORS.warning,
          status: event.part.toolName === "task" ? "Subagent running" : "Tool running",
        })
        return
      }

      if (event.part.type === "reasoning" || event.part.type === "text") {
        const kind = event.part.type === "reasoning" ? ("reasoning" as const) : ("answer" as const)
        const label = kind === "reasoning" ? "thinking" : "answer"
        const entryID = input.createTraceID()
        entryByPart.set(event.part.id, entryID)

        const full = event.part.text
        const clip = kind === "reasoning" || !topLevel
        appendEntry({
          id: entryID,
          ...baseEntry(event),
          kind,
          title: `${path.join(" > ")} > ${label}`,
          text: clip ? preview(full, 240) : full,
          detail: clip && shouldCollapse(full, 240) ? full : undefined,
          color: kind === "reasoning" ? COLORS.warning : COLORS.text,
        })
      }
      return
    }

    if (event.type === "part.delta") {
      const entryID = entryByPart.get(event.partID)
      if (!entryID) return

      const topLevel = event.sessionID === event.rootID
      const clip = event.partType === "reasoning" || !topLevel
      updateEntry(entryID, (entry) => {
        const full = `${entry.detail ?? entry.text}${event.delta}`
        if (!clip) return { ...entry, text: `${entry.text}${event.delta}` }
        return { ...entry, text: preview(full, 240), detail: shouldCollapse(full, 240) ? full : undefined }
      })
      return
    }

    if (event.type === "part.updated" && event.part.type === "tool") {
      const entryID = entryByPart.get(event.part.id)
      if (!entryID) return
      const part = event.part
      const isTask = part.toolName === "task"

      if (part.state.status === "completed") {
        const output = part.state.output
        updateEntry(entryID, (entry) => ({
          ...entry,
          status: isTask ? "Subagent completed" : "Tool completed",
          text: summarizeToolOutput(part.toolName, output),
          detail: shouldCollapse(output, 220) ? output : undefined,
          color: COLORS.success,
        }))
        return
      }

      if (part.state.status === "error") {
        const message = part.state.error.message
        updateEntry(entryID, (entry) => ({
          ...entry,
          status: isTask ? "Subagent failed" : "Tool failed",
          text: preview(message, 220),
          detail: shouldCollapse(message, 220) ? message : undefined,
          color: COLORS.danger,
        }))
      }
    }
  }

  return { handleState, handleLoop }
}

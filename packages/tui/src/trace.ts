import type { RuntimeContext } from "@harness/runtime/context"
import type { RuntimeEvent } from "@harness/runtime/events"
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

export function handleTraceEvent(
  event: RuntimeEvent,
  store: RuntimeContext["session_store"],
  sessionPaths: Map<string, string[]>,
  activeTurns: Map<string, { turnID: string; agent: string; reasoningEntryID?: string; answerEntryID?: string }>,
  activeTools: Map<string, string[]>,
  createTraceID: () => string,
  setTraceEntries: Setter<TraceEntry[]>,
) {
  const appendEntry = (entry: TraceEntry) => {
    setTraceEntries((current) => [...current, entry])
  }

  const updateEntry = (entryID: string, updater: (entry: TraceEntry) => TraceEntry) => {
    setTraceEntries((current) => current.map((entry) => (entry.id === entryID ? updater(entry) : entry)))
  }

  const pathForSession = (sessionID: string, fallbackAgent?: string) => {
    const existing = sessionPaths.get(sessionID)
    if (existing) return existing

    try {
      const session = store.get(sessionID)
      const parentPath = session?.parentID ? sessionPaths.get(session.parentID) ?? [] : []
      return fallbackAgent ? [...parentPath, fallbackAgent] : parentPath
    } catch {
      return fallbackAgent ? [] : []
    }
  }

  const pushToolID = (sessionID: string, entryID: string) => {
    const ids = activeTools.get(sessionID) ?? []
    ids.push(entryID)
    activeTools.set(sessionID, ids)
  }

  const popToolID = (sessionID: string, tool: string) => {
    const ids = activeTools.get(sessionID) ?? []
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const entryID = ids[index]
      ids.splice(index, 1)
      activeTools.set(sessionID, ids)
      return entryID
    }
    void tool
    return undefined
  }

  if (event.type === "session-start") {
    let parentPath: string[] = []
    try {
      const session = store.get(event.sessionID)
      parentPath = session?.parentID ? sessionPaths.get(session.parentID) ?? [] : []
    } catch {}
    const path = [...parentPath, event.agent]
    sessionPaths.set(event.sessionID, path)
    appendEntry({
      id: createTraceID(),
      sessionID: event.sessionID,
      kind: "user",
      title: `${path.join(" > ")} > user`,
      text: event.text,
      color: COLORS.accent,
    })
    return
  }

  if (event.type === "turn-start") {
    activeTurns.set(event.sessionID, { turnID: event.turnID, agent: event.agent })
    return
  }

  if (event.type === "reasoning") {
    const turn = activeTurns.get(event.sessionID)
    if (!turn) return
    const title = `${pathForSession(event.sessionID, turn.agent).join(" > ")} > thinking`
    if (!turn.reasoningEntryID) {
      const entryID = createTraceID()
      turn.reasoningEntryID = entryID
      appendEntry({ id: entryID, sessionID: event.sessionID, kind: "reasoning", title, text: preview(event.textDelta, 240), detail: shouldCollapse(event.textDelta, 240) ? event.textDelta : undefined, color: COLORS.warning })
      return
    }
    updateEntry(turn.reasoningEntryID, (entry) => {
      const detail = `${entry.detail ?? entry.text}${event.textDelta}`
      return { ...entry, detail: shouldCollapse(detail, 240) ? detail : undefined, text: preview(detail, 240) }
    })
    return
  }

  if (event.type === "text") {
    const turn = activeTurns.get(event.sessionID)
    if (!turn) return
    const path = pathForSession(event.sessionID, turn.agent)
    const title = `${path.join(" > ")} > answer`
    if (!turn.answerEntryID) {
      const entryID = createTraceID()
      turn.answerEntryID = entryID
      appendEntry({
        id: entryID,
        sessionID: event.sessionID,
        kind: "answer",
        title,
        text: path.length > 1 ? preview(event.textDelta, 240) : event.textDelta,
        detail: path.length > 1 && shouldCollapse(event.textDelta, 240) ? event.textDelta : undefined,
        color: COLORS.text,
      })
      return
    }
    updateEntry(turn.answerEntryID, (entry) => {
      if (path.length > 1) {
        const detail = `${entry.detail ?? entry.text}${event.textDelta}`
        return { ...entry, text: preview(detail, 240), detail: shouldCollapse(detail, 240) ? detail : undefined }
      }
      const full = `${entry.text}${event.textDelta}`
      return { ...entry, text: full }
    })
    return
  }

  if (event.type === "tool-call") {
    const path = pathForSession(event.sessionID, event.agent)
    const toolLabel = formatTraceToolLabel(event.tool, event.args)
    const entryID = createTraceID()
    appendEntry({
      id: entryID,
      sessionID: event.sessionID,
      kind: "tool",
      title: `${path.join(" > ")} > ${toolLabel}`,
      text: summarizeToolInput(event.tool, event.args),
      detail: shouldCollapse(safeJson(event.args), 220) ? safeJson(event.args) : undefined,
      color: COLORS.warning,
      status: event.tool === "task" ? "Subagent starting" : "Tool queued",
    })
    pushToolID(event.sessionID, entryID)
    return
  }

  if (event.type === "tool-start") {
    const entryID = popToolID(event.sessionID, event.tool)
    if (!entryID) return
    updateEntry(entryID, (entry) => ({ ...entry, status: event.tool === "task" ? "Subagent running" : "Tool running" }))
    pushToolID(event.sessionID, entryID)
    return
  }

  if (event.type === "tool-result") {
    const entryID = popToolID(event.sessionID, event.tool)
    if (!entryID) return
    updateEntry(entryID, (entry) => ({
      ...entry,
      status: event.tool === "task" ? "Subagent completed" : "Tool completed",
      text: summarizeToolOutput(event.tool, event.output),
      detail: shouldCollapse(typeof event.output === "string" ? event.output : safeJson(event.output), 220)
        ? typeof event.output === "string" ? event.output : safeJson(event.output)
        : undefined,
      color: COLORS.success,
    }))
    return
  }

  if (event.type === "tool-error") {
    const entryID = popToolID(event.sessionID, event.tool)
    if (!entryID) return
    updateEntry(entryID, (entry) => ({ ...entry, status: event.tool === "task" ? "Subagent failed" : "Tool failed", text: preview(event.error, 220), detail: shouldCollapse(event.error, 220) ? event.error : undefined, color: COLORS.danger }))
    return
  }

  if (event.type === "structured-output") {
    appendEntry({
      id: createTraceID(),
      sessionID: event.sessionID,
      kind: "result",
      title: `${pathForSession(event.sessionID, event.agent).join(" > ")} > structured`,
      text: preview(event.output, 220),
      detail: undefined,
      color: COLORS.info,
      status: "Structured output",
    })
    return
  }

  if (event.type === "error") {
    appendEntry({
      id: createTraceID(),
      sessionID: event.sessionID,
      kind: "error",
      title: `${pathForSession(event.sessionID, event.agent).join(" > ")} > error`,
      text: preview(event.error, 220),
      detail: shouldCollapse(event.error, 220) ? event.error : undefined,
      color: COLORS.danger,
      status: "Execution failed",
    })
  }
}

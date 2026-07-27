// Folds the two harness event channels into the TUI's flat trace timeline.
// Entirely self-contained: session lineage comes from session.created /
// session.start events and content joins on partID — the folder never reads
// the session store.
//
// It knows nothing about individual tools. A tool call's label and summary come
// from the ToolDisplay the tool itself declared; this file only decides which
// row a fact belongs to. Special-casing a tool here would mean re-deriving what
// the tool already stated, and drifting the moment its wording changed.
import type { LoopEvent, StateEvent, ToolPart } from "@agent-core"
import type { Setter } from "solid-js"
import type { TraceEntry, TraceToolStatus } from "@tui/types"
import { preview, shouldCollapse } from "@tui/theme"

/** The trace folder: subscribe `handleState` / `handleLoop` to the runtime bus. */
export type TraceFolder = {
  handleState(event: StateEvent): void
  handleLoop(event: LoopEvent): void
}

/**
 * Creates the trace folder feeding the transcript signal. All lineage and
 * content bookkeeping is internal; entries carry rootID/topLevel and the agent
 * path so the view can scope and lay out without further lookups.
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
  // sessionID → its id chain from the root down, so entries can carry lineage
  // without the view ever walking the parent map itself.
  const sessionChains = new Map<string, string[]>()
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

  const chainFor = (sessionID: string) => sessionChains.get(sessionID) ?? [sessionID]

  const baseEntry = (event: { sessionID: string; rootID: string }) => ({
    sessionID: event.sessionID,
    rootID: event.rootID,
    sessionChain: chainFor(event.sessionID),
    topLevel: event.sessionID === event.rootID,
  })

  const handleLoop = (event: LoopEvent) => {
    if (event.type === "session.start") {
      const parentID = sessionParents.get(event.sessionID)
      const parentPath = parentID ? sessionPaths.get(parentID) ?? [] : []
      const path = [...parentPath, event.agent]
      sessionPaths.set(event.sessionID, path)

      const parentChain = parentID ? sessionChains.get(parentID) ?? [parentID] : []
      sessionChains.set(event.sessionID, [...parentChain, event.sessionID])

      appendEntry({
        id: input.createTraceID(),
        ...baseEntry(event),
        path,
        kind: "user",
        text: event.text,
      })
      return
    }

    if (event.type === "turn.end" && event.reason === "error" && event.error) {
      appendEntry({
        id: input.createTraceID(),
        ...baseEntry(event),
        path: pathFor(event.sessionID, event.agent),
        kind: "error",
        text: preview(event.error, 220),
        detail: shouldCollapse(event.error, 220) ? event.error : undefined,
      })
    }
  }

  // One row per call. There is deliberately no merging: every file tool acts on
  // a file once — write replaces it, edit changes one place in it — so two calls
  // are two facts, and collapsing them would hide one of them.
  const openToolEntry = (event: { sessionID: string; rootID: string }, path: string[], part: ToolPart) => {
    const entryID = input.createTraceID()
    entryByPart.set(part.id, entryID)

    appendEntry({
      id: entryID,
      ...baseEntry(event),
      path,
      kind: "tool",
      text: "",
      tool: { name: part.toolName, display: part.state.display, status: "running" },
    })
  }

  const settleToolEntry = (part: ToolPart, status: TraceToolStatus, detail: string | undefined) => {
    const entryID = entryByPart.get(part.id)
    if (!entryID) return

    updateEntry(entryID, (entry) => ({
      ...entry,
      detail: detail && shouldCollapse(detail, 220) ? detail : undefined,
      tool: {
        name: part.toolName,
        display: part.state.display,
        status,
      },
    }))
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
          path: pathFor(event.sessionID),
          kind: "result",
          text: preview(event.message.structured, 220),
        })
      }
      return
    }

    if (event.type === "part.created") {
      const message = messages.get(event.messageID)
      if (message?.role !== "assistant") return

      const path = pathFor(event.sessionID, message.agent)

      if (event.part.type === "tool") {
        openToolEntry(event, path, event.part)
        return
      }

      if (event.part.type === "reasoning" || event.part.type === "text") {
        const kind = event.part.type === "reasoning" ? ("reasoning" as const) : ("answer" as const)
        const entryID = input.createTraceID()
        entryByPart.set(event.part.id, entryID)

        const full = event.part.text
        const clip = kind === "reasoning" || event.sessionID !== event.rootID
        appendEntry({
          id: entryID,
          ...baseEntry(event),
          path,
          kind,
          text: clip ? preview(full, 240) : full,
          detail: clip && shouldCollapse(full, 240) ? full : undefined,
        })
      }
      return
    }

    if (event.type === "part.delta") {
      const entryID = entryByPart.get(event.partID)
      if (!entryID) return

      const clip = event.partType === "reasoning" || event.sessionID !== event.rootID
      updateEntry(entryID, (entry) => {
        const full = `${entry.detail ?? entry.text}${event.delta}`
        if (!clip) return { ...entry, text: `${entry.text}${event.delta}` }
        return { ...entry, text: preview(full, 240), detail: shouldCollapse(full, 240) ? full : undefined }
      })
      return
    }

    if (event.type === "part.updated" && event.part.type === "tool") {
      const part = event.part
      if (part.state.status === "completed") {
        settleToolEntry(part, "completed", part.state.output)
        return
      }
      if (part.state.status === "error") {
        settleToolEntry(part, "error", part.state.error.message)
        return
      }
      // Later running updates carry whatever the tool patched in mid-flight
      // (a summary, refined metadata); the verb and target were already there
      // when the row appeared.
      settleToolEntry(part, "running", undefined)
    }
  }

  return { handleState, handleLoop }
}

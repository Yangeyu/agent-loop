import type { ImageSource, RuntimeContext, ToolDisplay } from "@harness"

export type ComposerSubmitInput = {
  text: string
  images: ImageSource[]
}

export type TuiOptions = {
  runtime: RuntimeContext
  agent: string
  initialPrompt?: string
  autoSubmitInitial?: boolean
}

/**
 * What the run is doing right now, as separate facts rather than one sentence.
 * A single overwritten status string loses whichever fact arrived first — the
 * step number is gone the moment a phase lands — so the fields stay apart and
 * the status bar composes them.
 */
export type ActivityState = {
  phase: string
  step?: number
  maxSteps?: number
  agent?: string
  tool?: string
  startedAt?: number
  error?: string
  busy: boolean
}

export type TraceEntryKind = "user" | "reasoning" | "answer" | "tool" | "result" | "error"

export type TraceToolStatus = "running" | "completed" | "error"

/** The tool-specific half of a trace entry: what ran, and how it is going. */
export type TraceTool = {
  name: string
  display: ToolDisplay
  status: TraceToolStatus
  // How many calls this row stands for. Above 1 the row is a folded run of
  // calls sharing a mergeKey (every append to one file is one "write").
  calls: number
}

/**
 * One row of the transcript. Entries carry facts only — the agent chain, the
 * kind, the tool's own display — and never colours, symbols, or pre-joined
 * titles: how wide, how bright and how abbreviated a row renders is the view's
 * decision, and it is the only place that knows the viewport.
 */
export type TraceEntry = {
  id: string
  sessionID: string
  // The session's delegation-tree root — the transcript scopes on this.
  rootID: string
  // Session ids from the root down to this entry's own, so the view can hide a
  // whole delegated branch by testing one chain rather than walking parents.
  sessionChain: string[]
  // Whether the entry belongs to the root session itself (full-width answers).
  topLevel: boolean
  // The agent chain that produced this entry, outermost first.
  path: string[]
  kind: TraceEntryKind
  text: string
  detail?: string
  expanded?: boolean
  tool?: TraceTool
}

export type ComposerHandle = {
  clear: () => void
  focus: () => void
  value: () => string
  attachClipboardImage: () => Promise<void>
}

import type { ImageSource, RuntimeContext } from "@harness"

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

export type ActivityState = {
  phase: string
  status: string
  tool?: string
  busy: boolean
}

export type TraceEntry = {
  id: string
  sessionID: string
  // The session's delegation-tree root — the transcript scopes on this.
  rootID: string
  // Whether the entry belongs to the root session itself (full-width answers).
  topLevel: boolean
  kind: "user" | "reasoning" | "answer" | "tool" | "result" | "error"
  title: string
  text: string
  color: string
  status?: string
  detail?: string
  expanded?: boolean
}

export type ComposerHandle = {
  clear: () => void
  focus: () => void
  value: () => string
  attachClipboardImage: () => Promise<void>
}

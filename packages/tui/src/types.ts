import type { RuntimeContext } from "@harness"

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
}

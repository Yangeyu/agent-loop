import type { RuntimeContext } from "@harness/runtime/context"
import type { SessionInfo } from "@harness/types"

export const COLORS = {
  app: "#0a0a0a",
  sidebar: "#141414",
  panel: "#1e1e1e",
  panelSoft: "#282828",
  panelAccent: "#323232",
  border: "#3c3c3c",
  borderStrong: "#484848",
  text: "#eeeeee",
  muted: "#808080",
  accent: "#fab283",
  info: "#56b6c2",
  success: "#7fd88f",
  warning: "#f5a742",
  danger: "#e06c75",
} as const

export const PROMPT_PLACEHOLDERS = [
  "read src/core/session/prompt.ts and explain the loop",
  "investigate why the TUI stops streaming after a tool call",
  "refactor the runtime bootstrap with smaller boundaries",
  "review the latest session flow changes for regressions",
]

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
export const PROMPT_MAX_HEIGHT = 6

export function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

export function agentAccent(name: string) {
  const palette = [COLORS.accent, COLORS.info, COLORS.success, COLORS.warning, "#c792ea"]
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return palette[hash % palette.length]
}

function charDisplayWidth(char: string) {
  const code = char.codePointAt(0) ?? 0
  if (code === 0) return 0
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return 0
  return code > 0xff ? 2 : 1
}

export function estimateVisualLines(text: string, width: number) {
  const safeWidth = Math.max(1, width)
  const lines = text.split("\n")
  let total = 0

  for (const line of lines) {
    let currentWidth = 0
    let wrapped = 1

    for (const char of line) {
      const nextWidth = currentWidth + charDisplayWidth(char)
      if (nextWidth > safeWidth) {
        wrapped += 1
        currentWidth = charDisplayWidth(char)
        continue
      }
      currentWidth = nextWidth
    }

    total += wrapped
  }

  return Math.max(1, total)
}

export function resolveInitialAgent(agentRegistry: RuntimeContext["agent_registry"], agent: string) {
  try {
    return agentRegistry.get(agent).name
  } catch {
    return agentRegistry.defaultAgent().name
  }
}

export function moveSession(
  delta: number,
  sessions: SessionInfo[],
  currentSessionID: string | undefined,
  setCurrentSessionID: (sessionID: string) => void,
) {
  if (sessions.length === 0) return
  const currentIndex = currentSessionID
    ? sessions.findIndex((session) => session.id === currentSessionID)
    : -1
  const baseIndex = currentIndex === -1 ? 0 : currentIndex
  const nextIndex = (baseIndex + delta + sessions.length) % sessions.length
  setCurrentSessionID(sessions[nextIndex].id)
}

export function buildSessionTitle(text?: string) {
  const value = (text ?? "New session").trim()
  if (!value) return "New session"
  return value.length > 40 ? `${value.slice(0, 37)}...` : value
}

export function preview(value: unknown, max = 220) {
  const text = typeof value === "string" ? value : safeJson(value)
  const compact = text.replace(/\s+/g, " ").trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 3)}...`
}

export function shouldCollapse(value: string, max = 240) {
  const lineCount = value.split("\n").length
  return value.trim().length > max || lineCount > 5
}

export function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function asRecord(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  return value as Record<string, unknown>
}

export function belongsToSessionTree(
  store: RuntimeContext["session_store"],
  sessionID: string,
  rootSessionID: string | undefined,
) {
  if (!rootSessionID) return true

  let current: string | undefined = sessionID
  while (current) {
    if (current === rootSessionID) return true
    try {
      const session = store.get(current)
      current = session?.parentID
    } catch {
      break
    }
  }

  return false
}

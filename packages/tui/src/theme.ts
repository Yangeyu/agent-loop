import type { RuntimeContext } from "@harness"

export const COLORS = {
  app: "#0a0a0a",
  panel: "#1e1e1e",
  panelSoft: "#282828",
  panelAccent: "#323232",
  border: "#3c3c3c",
  borderStrong: "#484848",
  text: "#eeeeee",
  muted: "#808080",
  // Process rows sit below muted: thinking and settled tool calls are the
  // background a transcript is read against, not things to look at.
  dim: "#5a5a5a",
  accent: "#fab283",
  info: "#56b6c2",
  success: "#7fd88f",
  warning: "#f5a742",
  danger: "#e06c75",
} as const

const ELLIPSIS = "…"

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

/**
 * Fits text to a column width, eliding the middle. Paths and commands carry
 * their meaning at both ends — `packages/…/loop.ts` still identifies the file,
 * while a tail-truncated `packages/harness/src/agen…` identifies nothing.
 *
 * This is the surface's job by construction: a tool states the full target and
 * only the view knows how many columns are left for it.
 *
 * @param text - the full text
 * @param width - the available display width in cells
 * @returns the text, elided in the middle when it does not fit
 */
export function fitText(text: string, width: number) {
  if (width <= 0) return ""
  if (displayWidth(text) <= width) return text

  // The ellipsis is measured, not assumed to be one cell: under this module's
  // width rule it occupies two, and budgeting one for it overflows the column.
  const ellipsisWidth = displayWidth(ELLIPSIS)
  if (width <= ellipsisWidth) return ELLIPSIS

  const half = (width - ellipsisWidth) / 2
  return `${takeWidth(text, Math.ceil(half))}${ELLIPSIS}${takeWidth(text, Math.floor(half), "end")}`
}

export function displayWidth(text: string) {
  let total = 0
  for (const char of text) total += charDisplayWidth(char)
  return total
}

function takeWidth(text: string, width: number, from: "start" | "end" = "start") {
  const chars = [...text]
  const ordered = from === "start" ? chars : chars.reverse()
  const taken: string[] = []
  let used = 0

  for (const char of ordered) {
    const next = used + charDisplayWidth(char)
    if (next > width) break
    taken.push(char)
    used = next
  }

  return from === "start" ? taken.join("") : taken.reverse().join("")
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
    return agentRegistry.get(agent).definition.name
  } catch {
    return agentRegistry.defaultAgent().definition.name
  }
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

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

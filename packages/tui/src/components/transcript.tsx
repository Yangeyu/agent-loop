// The transcript's three layers, by visual weight:
//
//   conversation  user prompts and top-level answers — full width, no prefix,
//                 body colour. This is what the user actually reads.
//   process       tool calls and thinking — exactly one line each, dim, marked
//                 by a status glyph. A run of nine appends must not cost nine
//                 screens of a terminal that only has one.
//   detail        the full input/output, only when asked for.
//
// Colour encodes attention, not category: a finished call is dim because
// success is the normal case, and painting it green leaves nothing bright for
// the failure that actually needs the eye.
import { COLORS, SPINNER_FRAMES, fitText } from "@tui/theme"
import type { TraceEntry, TraceToolStatus } from "@tui/types"
import { TextAttributes } from "@opentui/core"
import { Show } from "solid-js"
import { spawn } from "node:child_process"

// Width reserved for the glyph, its gap, and the summary column's separator.
const GLYPH_COLUMN = 2
const SUMMARY_GAP = 2
const INDENT_PER_LEVEL = 2

function copyToClipboard(text: string) {
  if (process.platform !== "darwin") return
  const proc = spawn("pbcopy")
  proc.stdin.write(text)
  proc.stdin.end()
}

export function WelcomeCard() {
  return (
    <box flexDirection="column" gap={1}>
      <text fg={COLORS.text} attributes={TextAttributes.BOLD}>Transcript</text>
      <text fg={COLORS.muted}>Ready to chat.</text>
    </box>
  )
}

export function TraceEntryBlock(props: {
  entry: TraceEntry
  expanded: boolean
  width: number
  spinnerFrame: number
  branchCollapsed: boolean
  onToggle: () => void
  onToggleBranch: () => void
}) {
  // A delegated session's prompt is the header of its branch: folding it away
  // takes the branch with it, so a finished subagent costs one line.
  const isBranchHeader = () => props.entry.kind === "user" && !props.entry.topLevel
  // Depth is drawn as indentation rather than repeated in every row's text: an
  // agent chain printed as "lead > general > read" spends the width it is
  // supposed to be saving.
  const indent = () => Math.max(0, props.entry.path.length - 1) * INDENT_PER_LEVEL
  const inner = () => Math.max(8, props.width - indent())
  const collapsible = () => Boolean(props.entry.detail)

  return (
    <box flexDirection="column" marginLeft={indent()}>
      <Show when={props.entry.kind === "user" && !isBranchHeader()}>
        <PromptRow text={props.entry.text} />
      </Show>

      <Show when={isBranchHeader()}>
        <ProcessRow
          glyph={props.branchCollapsed ? "▸" : "▾"}
          glyphColor={COLORS.info}
          label={`${props.entry.path.at(-1) ?? "subagent"} — ${props.entry.text}`}
          width={inner()}
          bright
          collapsible={false}
          expanded={false}
          onToggle={props.onToggleBranch}
        />
      </Show>

      <Show when={props.entry.kind === "answer" && props.entry.topLevel}>
        <text selectable fg={COLORS.text}>{props.entry.text || " "}</text>
      </Show>

      <Show when={props.entry.kind === "result"}>
        <text selectable fg={COLORS.info}>{props.entry.text || " "}</text>
      </Show>

      <Show when={props.entry.kind === "tool" && props.entry.tool}>
        <ProcessRow
          glyph={toolGlyph(props.entry.tool?.status, props.spinnerFrame)}
          glyphColor={toolColor(props.entry.tool?.status)}
          label={toolLabel(props.entry)}
          summary={toolSummary(props.entry)}
          width={inner()}
          bright={props.entry.tool?.status === "running"}
          collapsible={collapsible()}
          expanded={props.expanded}
          onToggle={props.onToggle}
        />
      </Show>

      <Show when={props.entry.kind === "reasoning" || (props.entry.kind === "answer" && !props.entry.topLevel)}>
        <ProcessRow
          glyph="·"
          glyphColor={COLORS.dim}
          label={props.entry.text}
          width={inner()}
          bright={false}
          collapsible={collapsible()}
          expanded={props.expanded}
          onToggle={props.onToggle}
        />
      </Show>

      <Show when={props.entry.kind === "error"}>
        <ProcessRow
          glyph="✗"
          glyphColor={COLORS.danger}
          label={props.entry.text}
          width={inner()}
          bright
          collapsible={collapsible()}
          expanded={props.expanded}
          onToggle={props.onToggle}
        />
      </Show>

      <Show when={props.expanded && props.entry.detail}>
        <box flexDirection="column" gap={0} marginTop={1} marginBottom={1}>
          <box border borderColor={COLORS.border} paddingLeft={1} paddingRight={1}>
            <text selectable fg={COLORS.muted}>{props.entry.detail}</text>
          </box>
          <box onMouseUp={() => copyToClipboard(props.entry.detail ?? props.entry.text)}>
            <text fg={COLORS.dim}>[ copy ]</text>
          </box>
        </box>
      </Show>
    </box>
  )
}

function PromptRow(props: { text: string }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={COLORS.accent}>›</text>
      <text selectable fg={COLORS.text}>{props.text || " "}</text>
    </box>
  )
}

// One line, always. The label gives up its width to the summary rather than
// wrapping, because a wrapped process row costs the same as two rows.
function ProcessRow(props: {
  glyph: string
  glyphColor: string
  label: string
  summary?: string
  width: number
  bright: boolean
  collapsible: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const marker = () => (props.collapsible ? (props.expanded ? " ▾" : " ▸") : "")
  const summaryWidth = () => (props.summary ? props.summary.length + SUMMARY_GAP : 0)
  const labelWidth = () => Math.max(4, props.width - GLYPH_COLUMN - summaryWidth() - marker().length)

  return (
    <box flexDirection="row" gap={1} onMouseUp={props.onToggle}>
      <text fg={props.glyphColor}>{props.glyph}</text>
      <text fg={props.bright ? COLORS.muted : COLORS.dim}>{fitText(collapseWhitespace(props.label), labelWidth())}</text>
      <Show when={props.summary}>
        <text fg={COLORS.dim}>{props.summary}</text>
      </Show>
      <Show when={props.collapsible}>
        <text fg={COLORS.dim}>{marker().trim()}</text>
      </Show>
    </box>
  )
}

function toolGlyph(status: TraceToolStatus | undefined, spinnerFrame: number) {
  if (status === "running") return SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? "◐"
  if (status === "error") return "✗"
  return "⏺"
}

function toolColor(status: TraceToolStatus | undefined) {
  if (status === "running") return COLORS.accent
  if (status === "error") return COLORS.danger
  return COLORS.dim
}

// The row's text is assembled here, from the facts the tool stated — the tool
// never sees a viewport and so never pre-joins these.
function toolLabel(entry: TraceEntry) {
  const display = entry.tool?.display
  if (!display) return entry.text
  return [display.verb, display.target].filter(Boolean).join(" ")
}

function toolSummary(entry: TraceEntry) {
  const tool = entry.tool
  if (!tool) return undefined
  const calls = tool.calls > 1 ? `${tool.calls} calls` : undefined
  return [tool.display.summary, calls].filter(Boolean).join(" · ") || undefined
}

function collapseWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

import type { RuntimeContext } from "@harness"
import { COLORS } from "@tui/theme"
import type { TraceEntry } from "@tui/types"
import { TextAttributes } from "@opentui/core"
import { Show } from "solid-js"
import { spawn } from "node:child_process"

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
      <text fg={COLORS.text}>Ready to chat.</text>
      <text fg={COLORS.muted}>Trace output is flattened by execution path and updates live as tools and subagents run.</text>
    </box>
  )
}

export function TraceEntryBlock(props: {
  store: RuntimeContext["session_store"]
  entry: TraceEntry
  expanded: boolean
  onToggle: () => void
}) {
  const isTopLevelAnswer = props.entry.kind === "answer" && !props.store.get(props.entry.sessionID)?.parentID
  const collapsible = Boolean(props.entry.detail) && !isTopLevelAnswer && props.entry.kind !== "result"
  const fg = props.entry.kind === "answer" || props.entry.kind === "result" ? COLORS.text : COLORS.muted

  const handleCopy = () => {
    copyToClipboard(props.entry.detail ?? props.entry.text)
  }

  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" gap={1}>
        <text fg={props.entry.color}>•</text>
        <box flexDirection="column" flexGrow={1}>
          <box flexDirection="row" gap={1}>
            <text fg={props.entry.color}>{props.entry.title}</text>
            <Show when={props.entry.status}>
              <text fg={COLORS.muted}>{props.entry.status}</text>
            </Show>
          </box>

          <box marginTop={props.expanded && collapsible ? 1 : 0}>
            <Show
              when={props.expanded && collapsible}
              fallback={<text selectable fg={fg}>{props.entry.text || " "}</text>}
            >
              <box border borderColor={COLORS.border} paddingLeft={1} paddingRight={1}>
                <text selectable fg={fg}>{props.entry.detail}</text>
              </box>
            </Show>
          </box>

          <box flexDirection="row" gap={2} marginTop={1}>
            <Show when={collapsible}>
              <box onMouseUp={props.onToggle}>
                <text fg={COLORS.muted}>[ {props.expanded ? "Hide details" : "Show details"} ]</text>
              </box>
            </Show>
            <box onMouseUp={handleCopy}>
              <text fg={COLORS.muted}>[ Copy ]</text>
            </box>
          </box>
        </box>
      </box>
    </box>
  )
}

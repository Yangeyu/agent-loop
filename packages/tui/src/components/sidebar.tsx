import type { SessionInfo } from "@harness/types"
import { COLORS } from "@tui/theme"
import type { ActivityState } from "@tui/types"
import { TextAttributes } from "@opentui/core"
import { For, Show } from "solid-js"

function SidebarPanel(props: { title: string; children: unknown; grow?: boolean }) {
  return (
    <box flexDirection="column" gap={1} flexGrow={props.grow ? 1 : undefined}>
      <text fg={COLORS.text} attributes={TextAttributes.BOLD}>{props.title}</text>
      {props.children}
    </box>
  )
}

export function Sidebar(props: {
  width: number
  sessions: SessionInfo[]
  currentSessionID?: string
  selectedAgent: string
  activity: ActivityState
  notice?: string
  onSelectSession: (sessionID: string) => void
}) {
  const currentSession = () => props.sessions.find((session) => session.id === props.currentSessionID)

  return (
    <box
      width={props.width}
      height="100%"
      flexDirection="column"
      backgroundColor={COLORS.app}
      paddingLeft={3}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={2}
    >
      <SidebarPanel title={currentSession()?.title ?? "Session"}>
        <Show when={props.notice}>
          <text fg={COLORS.info}>{props.notice}</text>
        </Show>
      </SidebarPanel>

      <box>
        <text fg={COLORS.text} attributes={TextAttributes.BOLD}>Context</text>
        <text fg={COLORS.muted}>Session context active</text>
      </box>

      <SidebarPanel title="Sessions" grow>
        <Show when={props.sessions.length > 0} fallback={<text fg={COLORS.muted}>No sessions yet</text>}>
          <scrollbox flexDirection="column" gap={1}>
            <For each={props.sessions}>
              {(session) => (
                <box onMouseUp={() => props.onSelectSession(session.id)}>
                  <text fg={session.id === props.currentSessionID ? COLORS.text : COLORS.muted} attributes={session.id === props.currentSessionID ? TextAttributes.BOLD : TextAttributes.NONE}>
                    {session.title}
                  </text>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
      </SidebarPanel>

      <box paddingTop={2} border={["top"]} borderColor={COLORS.border} flexDirection="row" gap={1}>
        <text fg={COLORS.muted}>•</text>
        <text fg={COLORS.muted}>Agentic Runtime</text>
      </box>
    </box>
  )
}

import { COLORS } from "@tui/theme"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"

export function CrashView(props: { error: unknown; onReset: () => void }) {
  const term = useTerminalDimensions()
  const renderer = useRenderer()
  const message = props.error instanceof Error ? props.error.stack ?? props.error.message : String(props.error)

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") {
      renderer.destroy()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.name === "return") {
      props.onReset()
      event.preventDefault()
      event.stopPropagation()
    }
  })

  return (
    <box width={term().width} height={term().height} backgroundColor={COLORS.app} padding={1}>
      <box border borderColor={COLORS.danger} backgroundColor={COLORS.panel} padding={1} flexDirection="column" gap={1}>
        <text fg={COLORS.danger} attributes={TextAttributes.BOLD}>TUI crashed</text>
        <text fg={COLORS.muted}>Press Enter to reset or Ctrl+C to exit.</text>
        <scrollbox flexGrow={1} border borderColor={COLORS.border} padding={1}>
          <text fg={COLORS.text}>{message}</text>
        </scrollbox>
      </box>
    </box>
  )
}

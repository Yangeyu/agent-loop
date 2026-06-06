import { resolveModelSpec } from "@harness"
import { appendPromptHistory, loadPromptHistory, type PromptHistoryEntry } from "@tui/prompt-history"
import { getTextareaKeybindings } from "@tui/textarea-keybindings"
import { COLORS, PROMPT_MAX_HEIGHT, SPINNER_FRAMES, agentAccent, estimateVisualLines, titleCase } from "@tui/theme"
import type { ComposerHandle } from "@tui/types"
import type { TextareaRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

const COMPOSER_FOOTER_HEIGHT = 2

function clampInputHeight(lines: number) {
  return Math.max(1, Math.min(PROMPT_MAX_HEIGHT, lines))
}

function calculateInputHeight(text: string, wrapWidth: number, measuredLines?: number) {
  const estimatedLines = estimateVisualLines(text, wrapWidth)
  return clampInputHeight(Math.max(estimatedLines, measuredLines ?? estimatedLines))
}

export function ComposerCard(props: {
  ref: (value: unknown) => void
  initialValue?: string
  busy: boolean
  onSubmit: (value: string) => Promise<void> | void
  selectedAgent: string
  activityStatus: string
}) {
  const modelSpec = resolveModelSpec()
  const renderer = useRenderer()
  const term = useTerminalDimensions()
  const [inputHeight, setInputHeight] = createSignal(1)
  const [value, setValue] = createSignal(props.initialValue ?? "")
  const [history, setHistory] = createSignal<PromptHistoryEntry[]>([])
  const [historyCursor, setHistoryCursor] = createSignal(0)
  const [historyDraft, setHistoryDraft] = createSignal("")
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  const highlight = createMemo(() => agentAccent(props.selectedAgent))
  let textareaRef: TextareaRenderable | undefined
  let refreshQueued = false
  let resizeTimer: ReturnType<typeof setTimeout> | undefined

  const inputWrapWidth = () => {
    const measured = textareaRef?.width
    if (typeof measured === "number" && measured > 0) return Math.max(1, measured)
    return Math.max(24, term().width - 44)
  }

  const composerBodyHeight = () => inputHeight() + 4
  const composerTotalHeight = () => composerBodyHeight() + COMPOSER_FOOTER_HEIGHT

  const syncInputHeight = (nextValue = value()) => {
    setInputHeight(calculateInputHeight(nextValue, inputWrapWidth(), textareaRef?.virtualLineCount))
  }

  const requestTextareaRefresh = () => {
    if (refreshQueued) return
    refreshQueued = true

    queueMicrotask(() => {
      refreshQueued = false
      textareaRef?.getLayoutNode().markDirty()
      textareaRef?.requestRender()
      renderer.requestRender()

      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        textareaRef?.getLayoutNode().markDirty()
        textareaRef?.requestRender()
        renderer.requestRender()
        syncInputHeight()
      }, 0)
    })
  }

  const updateValue = (next: string) => {
    setValue(next)
    syncInputHeight(next)
  }

  const applyValue = (next: string) => {
    updateValue(next)
    if (textareaRef && textareaRef.plainText !== next) {
      textareaRef.setText(next)
    }
    requestTextareaRefresh()
  }

  const clear = () => {
    setHistoryCursor(0)
    setHistoryDraft("")
    updateValue("")
    textareaRef?.clear()
    requestTextareaRefresh()
  }

  const moveHistory = (direction: -1 | 1) => {
    const entries = history()
    if (!textareaRef || entries.length === 0) return

    const cursor = historyCursor()
    const current = textareaRef.plainText

    if (direction === -1) {
      if (cursor >= entries.length) return
      if (cursor === 0) setHistoryDraft(current)
      const nextCursor = cursor + 1
      setHistoryCursor(nextCursor)
      applyValue(entries[entries.length - nextCursor].input)
      queueMicrotask(() => {
        if (textareaRef) textareaRef.cursorOffset = 0
      })
      return
    }

    if (cursor === 0) return
    const nextCursor = cursor - 1
    setHistoryCursor(nextCursor)
    applyValue(nextCursor === 0 ? historyDraft() : entries[entries.length - nextCursor].input)
    queueMicrotask(() => {
      if (textareaRef) textareaRef.cursorOffset = textareaRef.plainText.length
    })
  }

  const submit = async () => {
    const text = value().trim()
    if (!text || props.busy) return

    const current = value()
    const nextHistory = await appendPromptHistory({ input: current }, history()).catch(() => history())
    setHistory(nextHistory)
    clear()
    await props.onSubmit(current)
  }

  createEffect(() => {
    props.ref({
      clear,
      focus: () => textareaRef?.focus(),
      value: () => textareaRef?.plainText ?? value(),
    } satisfies ComposerHandle)
  })

  createEffect(() => {
    if (!props.busy) {
      setSpinnerFrame(0)
      return
    }

    const timer = setInterval(() => {
      setSpinnerFrame((current) => (current + 1) % SPINNER_FRAMES.length)
    }, 80)

    onCleanup(() => clearInterval(timer))
  })

  onMount(() => {
    loadPromptHistory()
      .then(setHistory)
      .catch(() => setHistory([]))

    queueMicrotask(() => {
      syncInputHeight(props.initialValue ?? "")
      requestTextareaRefresh()
    })
  })

  onCleanup(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
  })

  createEffect(() => {
    term().width
    syncInputHeight()
    requestTextareaRefresh()
  })

  return (
    <box height={composerTotalHeight()} flexDirection="column">
      <box height={composerBodyHeight()} flexDirection="column" flexShrink={0}>
        <box flexDirection="column">
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={0}
            backgroundColor={COLORS.panelAccent}
            flexDirection="column"
          >
            <textarea
              ref={(current) => {
                textareaRef = current
                syncInputHeight(current?.plainText ?? value())
                requestTextareaRefresh()
              }}
              focused
              initialValue={value()}
              height={inputHeight()}
              placeholder={props.busy ? "Agent is working..." : "Type your message..."}
              placeholderColor={COLORS.muted}
              textColor={COLORS.text}
              focusedTextColor={COLORS.text}
              focusedBackgroundColor={COLORS.panelAccent}
              cursorColor={COLORS.text}
              keyBindings={getTextareaKeybindings()}
              onContentChange={() => {
                const next = textareaRef?.plainText ?? ""
                updateValue(next)
                if (historyCursor() !== 0) setHistoryCursor(0)
                requestTextareaRefresh()
              }}
              onCursorChange={() => {
                syncInputHeight()
              }}
              onKeyDown={(event) => {
                if (!textareaRef) return

                if (event.name === "up" && textareaRef.cursorOffset === 0 && textareaRef.visualCursor.visualRow === 0) {
                  moveHistory(-1)
                  event.preventDefault()
                  event.stopPropagation()
                  return
                }

                if (
                  event.name === "down" &&
                  textareaRef.cursorOffset === textareaRef.plainText.length &&
                  textareaRef.visualCursor.visualRow === textareaRef.height - 1
                ) {
                  moveHistory(1)
                  event.preventDefault()
                  event.stopPropagation()
                }
              }}
              onSubmit={() => {
                void submit()
              }}
            />
            <box flexDirection="row" gap={1} flexShrink={0} paddingTop={1} paddingBottom={1}>
              <text fg={highlight()}>{titleCase(props.selectedAgent)}</text>
              <text fg={COLORS.text}>{modelSpec.defaults.modelID}</text>
              <text fg={COLORS.muted}>{modelSpec.provider}</text>
            </box>
          </box>
        </box>
      </box>
      <box
        height={COMPOSER_FOOTER_HEIGHT}
        flexShrink={0}
        flexDirection="row"
        justifyContent={props.busy ? "space-between" : "flex-end"}
        paddingLeft={2}
        paddingRight={1}
        paddingTop={1}
      >
        <Show when={props.busy}>
          <box flexDirection="row" gap={1}>
            <text fg={highlight()}>{SPINNER_FRAMES[spinnerFrame()]}</text>
            <text fg={COLORS.text}>{props.activityStatus}</text>
          </box>
        </Show>
        <box flexDirection="row" gap={2}>
          <text fg={COLORS.text}>enter <span style={{ fg: COLORS.muted }}>send</span></text>
          <text fg={COLORS.text}>shift+enter <span style={{ fg: COLORS.muted }}>newline</span></text>
          <text fg={COLORS.text}>up/down <span style={{ fg: COLORS.muted }}>history</span></text>
          <text fg={COLORS.text}>tab <span style={{ fg: COLORS.muted }}>agents</span></text>
          <text fg={COLORS.text}>ctrl+n <span style={{ fg: COLORS.muted }}>new</span></text>
          <text fg={COLORS.text}>ctrl+c <span style={{ fg: COLORS.muted }}>clear</span></text>
        </box>
      </box>
    </box>
  )
}

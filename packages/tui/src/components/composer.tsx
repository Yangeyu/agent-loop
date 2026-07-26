import { loadClipboardImage, parseInlineImageAttachments, type ComposerImageAttachment } from "@tui/images"
import { applyFileSuggestion, getFileSuggestions, listWorkspaceFiles, resolveActiveMention, type FileSuggestion } from "@tui/mention-files"
import { appendPromptHistory, loadPromptHistory, type PromptHistoryEntry } from "@tui/prompt-history"
import { getTextareaKeybindings } from "@tui/textarea-keybindings"
import { COLORS, PROMPT_MAX_HEIGHT, SPINNER_FRAMES, agentAccent, estimateVisualLines, titleCase } from "@tui/theme"
import type { ActivityState, ComposerHandle, ComposerSubmitInput } from "@tui/types"
import type { TextareaRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

const COMPOSER_FOOTER_HEIGHT = 2
const FILE_SUGGESTION_LIMIT = 6

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
  onSubmit: (value: ComposerSubmitInput) => Promise<void> | void
  onNotice?: (message: string) => void
  selectedAgent: string
  // The selected agent's bound model, shown in the footer (id + provider).
  model: { id: string; providerID: string }
  activity: ActivityState
  spinnerFrame: number
}) {
  const renderer = useRenderer()
  const term = useTerminalDimensions()
  const [inputHeight, setInputHeight] = createSignal(1)
  const [value, setValue] = createSignal(props.initialValue ?? "")
  const [history, setHistory] = createSignal<PromptHistoryEntry[]>([])
  const [historyCursor, setHistoryCursor] = createSignal(0)
  const [historyDraft, setHistoryDraft] = createSignal("")
  const [clipboardImages, setClipboardImages] = createSignal<ComposerImageAttachment[]>([])
  const [fileSuggestions, setFileSuggestions] = createSignal<FileSuggestion[]>([])
  const [fileSuggestionIndex, setFileSuggestionIndex] = createSignal(0)
  const [fileSuggestionOpen, setFileSuggestionOpen] = createSignal(false)
  const [fileSuggestionLoading, setFileSuggestionLoading] = createSignal(false)
  const highlight = createMemo(() => agentAccent(props.selectedAgent))
  const parsedImages = createMemo(() => parseInlineImageAttachments(value()).images)
  const attachments = createMemo(() => [...clipboardImages(), ...parsedImages()])
  let textareaRef: TextareaRenderable | undefined
  let refreshQueued = false
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let suggestionRequest = 0

  const inputWrapWidth = () => {
    const measured = textareaRef?.width
    if (typeof measured === "number" && measured > 0) return Math.max(1, measured)
    return Math.max(24, term().width - 44)
  }

  const suggestionHeight = () => {
    if (!fileSuggestionOpen()) return 0
    if (fileSuggestionLoading()) return 2
    return Math.min(fileSuggestions().length || 1, FILE_SUGGESTION_LIMIT) + 1
  }
  const composerBodyHeight = () => inputHeight() + 4 + (attachments().length > 0 ? 2 : 0) + suggestionHeight()
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
    setClipboardImages([])
    setFileSuggestionOpen(false)
    setFileSuggestions([])
    setFileSuggestionIndex(0)
    updateValue("")
    textareaRef?.clear()
    requestTextareaRefresh()
  }

  const attachClipboardImage = async () => {
    if (props.busy) return

    const result = loadClipboardImage()
    if (!result.ok) {
      props.onNotice?.(result.error)
      return
    }

    setClipboardImages((current) => [...current, result.attachment])
    props.onNotice?.(`Attached ${result.attachment.label}`)
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

  const refreshFileSuggestions = async () => {
    if (!textareaRef) return

    const mention = resolveActiveMention(textareaRef.plainText, textareaRef.cursorOffset)
    if (!mention) {
      setFileSuggestionOpen(false)
      setFileSuggestions([])
      setFileSuggestionIndex(0)
      setFileSuggestionLoading(false)
      return
    }

    const requestID = ++suggestionRequest
    setFileSuggestionOpen(true)
    setFileSuggestionLoading(true)

    try {
      const files = await listWorkspaceFiles(process.cwd())
      if (requestID !== suggestionRequest) return

      const suggestions = getFileSuggestions(files, mention.query, FILE_SUGGESTION_LIMIT)
      setFileSuggestions(suggestions)
      setFileSuggestionIndex((current) => Math.min(current, Math.max(suggestions.length - 1, 0)))
      setFileSuggestionLoading(false)
    } catch (error) {
      if (requestID !== suggestionRequest) return
      setFileSuggestionOpen(false)
      setFileSuggestions([])
      setFileSuggestionIndex(0)
      setFileSuggestionLoading(false)
      props.onNotice?.(error instanceof Error ? error.message : String(error))
    }
  }

  const moveFileSuggestion = (direction: -1 | 1) => {
    const suggestions = fileSuggestions()
    if (suggestions.length === 0) return
    setFileSuggestionIndex((current) => (current + direction + suggestions.length) % suggestions.length)
  }

  const acceptFileSuggestion = () => {
    if (!textareaRef) return false
    const suggestion = fileSuggestions()[fileSuggestionIndex()]
    if (!suggestion) return false

    const result = applyFileSuggestion(textareaRef.plainText, textareaRef.cursorOffset, suggestion)
    applyValue(result.text)
    queueMicrotask(() => {
      if (!textareaRef) return
      textareaRef.cursorOffset = result.cursorOffset
      void refreshFileSuggestions()
    })
    return true
  }

  const submit = async () => {
    const parsed = parseInlineImageAttachments(value())
    const text = parsed.text.trim()
    const images = [...clipboardImages(), ...parsed.images].map((image) => image.source)
    if ((text.length === 0 && images.length === 0) || props.busy) return

    const current = value()
    const nextHistory = await appendPromptHistory({ input: current }, history()).catch(() => history())
    setHistory(nextHistory)
    clear()
    await props.onSubmit({ text, images })
  }

  createEffect(() => {
    props.ref({
      clear,
      focus: () => textareaRef?.focus(),
      value: () => textareaRef?.plainText ?? value(),
      attachClipboardImage,
    } satisfies ComposerHandle)
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

  createEffect(() => {
    value()
    queueMicrotask(() => {
      void refreshFileSuggestions()
    })
  })

  return (
    <box height={composerTotalHeight()} flexDirection="column">
      <box height={composerBodyHeight()} flexDirection="column" flexShrink={0}>
        <box flexDirection="row">
          <box
            flexGrow={1}
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
                void refreshFileSuggestions()
              }}
              onKeyDown={(event) => {
                if (!textareaRef) return

                if (fileSuggestionOpen()) {
                  if (event.name === "up") {
                    moveFileSuggestion(-1)
                    event.preventDefault()
                    event.stopPropagation()
                    return
                  }

                  if (event.name === "down") {
                    moveFileSuggestion(1)
                    event.preventDefault()
                    event.stopPropagation()
                    return
                  }

                  if (event.name === "tab" || event.name === "return") {
                    if (acceptFileSuggestion()) {
                      event.preventDefault()
                      event.stopPropagation()
                      return
                    }
                  }

                  if (event.name === "escape") {
                    setFileSuggestionOpen(false)
                    setFileSuggestions([])
                    event.preventDefault()
                    event.stopPropagation()
                    return
                  }
                }

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
              <text fg={COLORS.text}>{props.model.id}</text>
              <text fg={COLORS.muted}>{props.model.providerID}</text>
            </box>
            <Show when={attachments().length > 0}>
              <box flexDirection="row" gap={1} flexShrink={0} paddingBottom={1}>
                <text fg={COLORS.muted}>images</text>
                <For each={attachments().slice(0, 3)}>
                  {(image) => <text fg={image.origin === "clipboard" ? COLORS.info : COLORS.warning}>{titleCase(image.origin)}</text>}
                </For>
                <text fg={COLORS.text}>{attachments().map((image) => image.label).join(" , ")}</text>
              </box>
            </Show>
            <Show when={fileSuggestionOpen()}>
              <box flexDirection="column" gap={0} paddingBottom={1}>
                <Show when={fileSuggestionLoading()} fallback={(
                  <Show when={fileSuggestions().length > 0} fallback={<text fg={COLORS.muted}>No matching files</text>}>
                    <For each={fileSuggestions()}>
                      {(suggestion, index) => (
                        <box flexDirection="row" gap={1} backgroundColor={index() === fileSuggestionIndex() ? COLORS.panelSoft : COLORS.panelAccent}>
                          <text fg={suggestion.image ? COLORS.warning : COLORS.info}>{index() === fileSuggestionIndex() ? ">" : " "}</text>
                          <text fg={suggestion.image ? COLORS.warning : COLORS.text}>{suggestion.path}</text>
                        </box>
                      )}
                    </For>
                  </Show>
                )}>
                  <text fg={COLORS.muted}>Searching files...</text>
                </Show>
              </box>
            </Show>
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
            <text fg={highlight()}>{SPINNER_FRAMES[props.spinnerFrame % SPINNER_FRAMES.length]}</text>
            <text fg={COLORS.muted}>{describeActivity(props.activity)}</text>
          </box>
        </Show>
        <box flexDirection="row" gap={2}>
          <text fg={COLORS.text}>enter <span style={{ fg: COLORS.muted }}>send</span></text>
          <text fg={COLORS.text}>shift+enter <span style={{ fg: COLORS.muted }}>newline</span></text>
          <text fg={COLORS.text}>up/down <span style={{ fg: COLORS.muted }}>history</span></text>
          <text fg={COLORS.text}>@ <span style={{ fg: COLORS.muted }}>files</span></text>
          <text fg={COLORS.text}>ctrl+v <span style={{ fg: COLORS.muted }}>clipboard image</span></text>
          <text fg={COLORS.text}>tab <span style={{ fg: COLORS.muted }}>agents</span></text>
          <text fg={COLORS.text}>ctrl+n <span style={{ fg: COLORS.muted }}>new</span></text>
          <text fg={COLORS.text}>ctrl+c <span style={{ fg: COLORS.muted }}>clear</span></text>
        </box>
      </box>
    </box>
  )
}

// The status line is composed from the activity's separate fields, so a fact
// that arrived earlier survives a later one: the step number stays visible
// while the phase and the running tool change underneath it.
//
// Elapsed time is read at render rather than tracked in a signal — the spinner
// already re-renders this row several times a second, and a second timer would
// only add another thing to keep in sync.
function describeActivity(activity: ActivityState) {
  const parts = [
    activity.agent,
    activity.step ? `step ${activity.step}${activity.maxSteps ? `/${activity.maxSteps}` : ""}` : undefined,
    activity.tool ?? activity.phase,
    activity.startedAt ? formatElapsed(Date.now() - activity.startedAt) : undefined,
  ].filter(Boolean)

  return `${parts.join(" · ")}  esc to cancel`
}

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`
}

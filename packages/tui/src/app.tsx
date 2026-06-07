import { runPrompt } from "@harness"
import { ComposerCard, CrashView, Sidebar, TraceEntryBlock, WelcomeCard } from "@tui/components"
import { handleTraceEvent } from "@tui/trace"
import { COLORS, belongsToSessionTree, buildSessionTitle, moveSession, resolveInitialAgent } from "@tui/theme"
import type { ActivityState, ComposerHandle, ComposerSubmitInput, TraceEntry, TuiOptions } from "@tui/types"
import { render, useKeyboard, useRenderer, useTerminalDimensions, useSelectionHandler } from "@opentui/solid"
import { ErrorBoundary, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { spawn } from "node:child_process"

export async function startTui(options: TuiOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("TUI requires an interactive terminal")
  }

  await render(() => <App {...options} />, {
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    autoFocus: true,
    openConsoleOnError: false,
  })
}

function App(props: TuiOptions) {
  const runtime = props.runtime
  const store = runtime.session_store
  const renderer = useRenderer()
  const term = useTerminalDimensions()
  const [selectedAgent, setSelectedAgent] = createSignal(resolveInitialAgent(runtime.agent_registry, props.agent))
  const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()
  const [activity, setActivity] = createSignal<ActivityState>({
    phase: "idle",
    status: "Ready",
    busy: false,
  })
  const [notice, setNotice] = createSignal<string>()
  const [revision, setRevision] = createSignal(0)
  const [traceEntries, setTraceEntries] = createSignal<TraceEntry[]>([])

  let abort: AbortController | undefined
  let composerRef: ComposerHandle | undefined
  let traceCount = 0
  const sessionPaths = new Map<string, string[]>()
  const activeTurns = new Map<string, { turnID: string; agent: string; reasoningEntryID?: string; answerEntryID?: string }>()
  const activeTools = new Map<string, string[]>()

  const refresh = () => setRevision((value) => value + 1)
  const toggleExpanded = (id: string) => {
    setTraceEntries((current) => current.map((entry) => (
      entry.id === id ? { ...entry, expanded: !entry.expanded } : entry
    )))
  }

  const sessions = createMemo(() => {
    revision()
    return store.list().slice().reverse()
  })

  const session = () => {
    revision()
    const sessionID = currentSessionID()
    if (!sessionID) return undefined
    const current = store.get(sessionID)
    return {
      ...current,
      messages: [...current.messages],
      parts: { ...current.parts },
    }
  }

  const visibleTranscript = () => {
    const rootSessionID = currentSessionID()
    return traceEntries().filter((entry) => belongsToSessionTree(store, entry.sessionID, rootSessionID))
  }

  const createSession = (text?: string) => {
    const next = store.create({ title: buildSessionTitle(text) })
    setCurrentSessionID(next.id)
    refresh()
    return next
  }

  const cancelTurn = () => {
    if (!abort) return
    abort.abort()
    setNotice("Cancelled current turn")
  }

  const cycleAgent = (delta: number) => {
    const primary = runtime.agent_registry.list().filter((agent) => agent.mode === "primary")
    if (primary.length === 0) return
    const currentIndex = Math.max(primary.findIndex((agent) => agent.name === selectedAgent()), 0)
    const nextIndex = (currentIndex + delta + primary.length) % primary.length
    setSelectedAgent(primary[nextIndex].name)
    setNotice(`Agent: ${primary[nextIndex].name}`)
  }

  const submitPrompt = async (input: ComposerSubmitInput) => {
    const text = input.text.trim()
    if (activity().busy || (text.length === 0 && input.images.length === 0)) return

    const nextSession = session() ?? createSession(text || "Image prompt")
    abort = new AbortController()
    setNotice(undefined)
    setActivity({
      phase: "starting",
      status: `Running ${selectedAgent()}`,
      busy: true,
    })

    try {
      await runPrompt({
        runtime,
        text,
        images: input.images,
        agent: selectedAgent(),
        sessionID: nextSession.id,
        abort: abort.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setActivity({
        phase: "error",
        status: message,
        busy: false,
      })
      setNotice(message)
      abort = undefined
    } finally {
      refresh()
      composerRef?.focus()
    }
  }

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") {
      if (activity().busy) {
        cancelTurn()
      } else if ((composerRef?.value() ?? "").length > 0) {
        composerRef?.clear()
        setNotice("Cleared draft")
        composerRef?.focus()
      } else {
        renderer.destroy()
      }
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.ctrl && event.name === "n") {
      createSession()
      composerRef?.clear()
      setNotice("Started a new session")
      composerRef?.focus()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.ctrl && event.name === "j") {
      moveSession(1, sessions(), currentSessionID(), setCurrentSessionID)
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.ctrl && event.name === "k") {
      moveSession(-1, sessions(), currentSessionID(), setCurrentSessionID)
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.name === "tab") {
      cycleAgent(event.shift ? -1 : 1)
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.ctrl && event.name === "v") {
      void composerRef?.attachClipboardImage()
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.name === "escape" && activity().busy) {
      cancelTurn()
      event.preventDefault()
      event.stopPropagation()
    }
  })

  onMount(() => {
    renderer.externalOutputMode = "passthrough"

    useSelectionHandler((selection) => {
      const text = selection.getSelectedText()
      if (text && process.platform === "darwin") {
        const proc = spawn("pbcopy")
        proc.stdin.write(text)
        proc.stdin.end()
        setNotice("Text copied to clipboard")
      }
    })

    const unsubscribe = runtime.events.subscribe((event) => {
      const rootSessionID = currentSessionID()

      if (!rootSessionID && event.type === "session-start") {
        setCurrentSessionID(event.sessionID)
      }

      handleTraceEvent(
        event,
        store,
        sessionPaths,
        activeTurns,
        activeTools,
        () => `trace-${++traceCount}`,
        setTraceEntries,
      )

      if (belongsToSessionTree(store, event.sessionID, currentSessionID())) {
        if (event.type === "turn-phase") {
          setActivity((current) => ({ ...current, phase: event.phase, status: `Phase ${event.phase}`, busy: true }))
        } else if (event.type === "tool-call") {
          setActivity((current) => ({ ...current, phase: "executing-tool", status: `Tool ${event.tool}`, tool: event.tool, busy: true }))
        } else if (event.type === "turn-start") {
          setActivity({ phase: "starting", status: `Step ${event.step}`, busy: true })
        } else if (event.type === "turn-complete") {
          abort = undefined
          setActivity({ phase: "done", status: `Done in ${event.durationMs}ms`, busy: false })
        } else if (event.type === "turn-abort") {
          abort = undefined
          setActivity({ phase: "aborted", status: `Aborted in ${event.durationMs}ms`, busy: false })
        } else if (event.type === "error") {
          abort = undefined
          setActivity({ phase: "error", status: event.error, busy: false })
        }
      }

      refresh()
    })
    onCleanup(unsubscribe)

    if (props.initialPrompt && props.autoSubmitInitial) {
      void submitPrompt({ text: props.initialPrompt, images: [] })
    }
  })

  createEffect(() => {
    revision()
    queueMicrotask(() => composerRef?.focus())
  })

  return (
    <ErrorBoundary fallback={(error, reset) => <CrashView error={error} onReset={reset} />}>
      <box width={term().width} height={term().height} backgroundColor={COLORS.app} flexDirection="row">
        <box flexGrow={1} flexDirection="column" paddingLeft={2} paddingTop={1} paddingBottom={1}>
          <scrollbox
            flexGrow={1}
            stickyScroll
            stickyStart="bottom"
            backgroundColor={COLORS.app}
          >
            <Show when={visibleTranscript().length > 0} fallback={<WelcomeCard />}>
              <box flexDirection="column" gap={1}>
                <For each={visibleTranscript()}>
                  {(entry) => (
                    <TraceEntryBlock 
                      store={store} 
                      entry={entry} 
                      expanded={Boolean(entry.expanded)} 
                      onToggle={() => toggleExpanded(entry.id)} 
                    />
                  )}
                </For>
              </box>
            </Show>
          </scrollbox>
          <box height={1} />
          <ComposerCard
            ref={(value) => {
              composerRef = value as ComposerHandle
            }}
            busy={activity().busy}
            onSubmit={submitPrompt}
            onNotice={setNotice}
            selectedAgent={selectedAgent()}
            activityStatus={activity().status}
            initialValue={props.autoSubmitInitial ? "" : props.initialPrompt ?? ""}
          />
        </box>
        <Sidebar
          width={32}
          sessions={sessions()}
          currentSessionID={currentSessionID()}
          selectedAgent={selectedAgent()}
          activity={activity()}
          notice={notice()}
          onSelectSession={setCurrentSessionID}
        />
      </box>
    </ErrorBoundary>
  )
}

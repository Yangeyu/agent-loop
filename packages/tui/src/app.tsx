import { runPrompt } from "@harness"
import { ComposerCard, CrashView, TraceEntryBlock, WelcomeCard } from "@tui/components"
import { createTraceFolder } from "@tui/trace"
import { COLORS, buildSessionTitle, resolveInitialAgent } from "@tui/theme"
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
  const sessions = runtime.sessions
  const renderer = useRenderer()
  const term = useTerminalDimensions()
  const [selectedAgent, setSelectedAgent] = createSignal(resolveInitialAgent(runtime.agent_registry, props.agent))
  // The selected agent's bound model, for the composer footer.
  const selectedModel = createMemo(() => {
    const model = runtime.agent_registry.get(selectedAgent()).model
    return { id: model.spec.id, providerID: model.providerID }
  })
  const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()
  const [activity, setActivity] = createSignal<ActivityState>({
    phase: "idle",
    status: "Ready",
    busy: false,
  })
  const [revision, setRevision] = createSignal(0)
  const [traceEntries, setTraceEntries] = createSignal<TraceEntry[]>([])

  let abort: AbortController | undefined
  let composerRef: ComposerHandle | undefined
  let traceCount = 0
  const trace = createTraceFolder({
    createTraceID: () => `trace-${++traceCount}`,
    setTraceEntries,
  })

  const refresh = () => setRevision((value) => value + 1)
  const toggleExpanded = (id: string) => {
    setTraceEntries((current) => current.map((entry) => (
      entry.id === id ? { ...entry, expanded: !entry.expanded } : entry
    )))
  }

  const session = () => {
    revision()
    const sessionID = currentSessionID()
    if (!sessionID) return undefined
    return sessions.get(sessionID)
  }

  const visibleTranscript = () => {
    const rootSessionID = currentSessionID()
    if (!rootSessionID) return traceEntries()
    // Entries carry their delegation tree's rootID; scoping is one comparison.
    return traceEntries().filter((entry) => entry.rootID === rootSessionID)
  }

  const createSession = (text?: string) => {
    const next = sessions.create({ title: buildSessionTitle(text) })
    setCurrentSessionID(next.id)
    refresh()
    return next
  }

  const cancelTurn = () => {
    if (!abort) return
    abort.abort()
  }

  const cycleAgent = (delta: number) => {
    const primary = runtime.agent_registry.list().filter((agent) => agent.mode === "primary")
    if (primary.length === 0) return
    const currentIndex = Math.max(primary.findIndex((agent) => agent.name === selectedAgent()), 0)
    const nextIndex = (currentIndex + delta + primary.length) % primary.length
    setSelectedAgent(primary[nextIndex].name)
  }

  const submitPrompt = async (input: ComposerSubmitInput) => {
    const text = input.text.trim()
    if (activity().busy || (text.length === 0 && input.images.length === 0)) return

    const nextSession = session() ?? createSession(text || "Image prompt")
    abort = new AbortController()
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
      composerRef?.focus()
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
      }
    })

    const inCurrentTree = (event: { rootID: string }) => {
      const rootSessionID = currentSessionID()
      return !rootSessionID || event.rootID === rootSessionID
    }

    const unsubscribeState = runtime.events.state.subscribe((event) => {
      trace.handleState(event)

      if (inCurrentTree(event) && event.type === "part.created" && event.part.type === "tool") {
        const tool = event.part.toolName
        setActivity((current) => ({ ...current, phase: "executing-tool", status: `Tool ${tool}`, tool, busy: true }))
      }

      refresh()
    })
    onCleanup(unsubscribeState)

    const unsubscribeLoop = runtime.events.loop.subscribe((event) => {
      if (!currentSessionID() && event.type === "session.start") {
        setCurrentSessionID(event.sessionID)
      }

      trace.handleLoop(event)

      if (inCurrentTree(event)) {
        if (event.type === "turn.phase") {
          setActivity((current) => ({ ...current, phase: event.phase, status: `Phase ${event.phase}`, busy: true }))
        } else if (event.type === "turn.start") {
          setActivity({ phase: "starting", status: `Step ${event.step}`, busy: true })
        } else if (event.type === "turn.end") {
          abort = undefined
          if (event.reason === "abort") {
            setActivity({ phase: "aborted", status: `Aborted in ${event.durationMs}ms`, busy: false })
          } else if (event.reason === "error") {
            setActivity({ phase: "error", status: event.error ?? "Turn failed", busy: false })
          } else {
            setActivity({ phase: "done", status: `Done in ${event.durationMs}ms`, busy: false })
          }
        }
      }

      refresh()
    })
    onCleanup(unsubscribeLoop)

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
      <box
        width={term().width}
        height={term().height}
        backgroundColor={COLORS.app}
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
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
          selectedAgent={selectedAgent()}
          model={selectedModel()}
          activityStatus={activity().status}
          initialValue={props.autoSubmitInitial ? "" : props.initialPrompt ?? ""}
        />
      </box>
    </ErrorBoundary>
  )
}

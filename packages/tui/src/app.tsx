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
    const model = runtime.agent_registry.get(selectedAgent()).definition.model
    return { id: model.spec.id, providerID: model.providerID }
  })
  const [currentSessionID, setCurrentSessionID] = createSignal<string | undefined>()
  const [activity, setActivity] = createSignal<ActivityState>({ phase: "idle", busy: false })
  // One tick drives every animated glyph — the composer's spinner and the
  // running rows in the transcript — so they never drift out of step.
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  const [revision, setRevision] = createSignal(0)
  const [traceEntries, setTraceEntries] = createSignal<TraceEntry[]>([])
  // Delegated sessions the user has folded away. Collapsing is keyed on the
  // session rather than on the task tool that opened it, so the view stays
  // ignorant of which tool delegates.
  const [collapsedSessions, setCollapsedSessions] = createSignal<ReadonlySet<string>>(new Set())

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

  const toggleSession = (sessionID: string) => {
    setCollapsedSessions((current) => {
      const next = new Set(current)
      if (!next.delete(sessionID)) next.add(sessionID)
      return next
    })
  }

  const session = () => {
    revision()
    const sessionID = currentSessionID()
    if (!sessionID) return undefined
    return sessions.get(sessionID)
  }

  const visibleTranscript = () => {
    const rootSessionID = currentSessionID()
    const collapsed = collapsedSessions()
    const inScope = rootSessionID
      ? // Entries carry their delegation tree's rootID; scoping is one comparison.
        traceEntries().filter((entry) => entry.rootID === rootSessionID)
      : traceEntries()

    if (collapsed.size === 0) return inScope

    // A collapsed session keeps its own header row — the one thing that says a
    // subagent ran and how it went — and hides everything beneath it.
    return inScope.filter((entry) => {
      const hidden = entry.sessionChain.findIndex((id) => collapsed.has(id))
      if (hidden === -1) return true
      return entry.kind === "user" && entry.sessionChain.length === hidden + 1
    })
  }

  const createSession = (text?: string) => {
    const next = sessions.create({ title: buildSessionTitle(text) })
    setCurrentSessionID(next.id)
    refresh()
    return next
  }

  const cancelRun = () => {
    if (!abort) return
    abort.abort()
  }

  const cycleAgent = (delta: number) => {
    const primary = runtime.agent_registry.list().filter((entry) => entry.mode === "primary")
    if (primary.length === 0) return
    const currentIndex = Math.max(primary.findIndex((entry) => entry.agent.definition.name === selectedAgent()), 0)
    const nextIndex = (currentIndex + delta + primary.length) % primary.length
    setSelectedAgent(primary[nextIndex].agent.definition.name)
  }

  const submitPrompt = async (input: ComposerSubmitInput) => {
    const text = input.text.trim()
    if (activity().busy || (text.length === 0 && input.images.length === 0)) return

    const nextSession = session() ?? createSession(text || "Image prompt")
    abort = new AbortController()
    setActivity({
      phase: "starting",
      agent: selectedAgent(),
      startedAt: Date.now(),
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
      setActivity((current) => ({ ...current, phase: "error", error: message, busy: false }))
      abort = undefined
    } finally {
      refresh()
      composerRef?.focus()
    }
  }

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") {
      if (activity().busy) {
        cancelRun()
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
      cancelRun()
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
        setActivity((current) => ({ ...current, phase: "executing-tool", tool, busy: true }))
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
        if (event.type === "step.phase") {
          // Each fact updates only its own field: a phase arriving must not
          // erase the step number the status bar is still showing.
          setActivity((current) => ({ ...current, phase: event.phase, busy: true }))
        } else if (event.type === "step.start") {
          setActivity((current) => ({
            ...current,
            phase: "starting",
            step: event.step,
            maxSteps: event.maxSteps,
            agent: event.agent,
            tool: undefined,
            error: undefined,
            startedAt: current.startedAt ?? Date.now(),
            busy: true,
          }))
        } else if (event.type === "step.end") {
          abort = undefined
          setActivity((current) => ({
            ...current,
            phase: event.reason === "abort" ? "aborted" : event.reason === "error" ? "error" : "done",
            tool: undefined,
            error: event.reason === "error" ? event.error ?? "step failed" : undefined,
            busy: false,
          }))
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

  createEffect(() => {
    if (!activity().busy) {
      setSpinnerFrame(0)
      return
    }

    const timer = setInterval(() => setSpinnerFrame((frame) => frame + 1), 80)
    onCleanup(() => clearInterval(timer))
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
                    width={term().width - 4}
                    spinnerFrame={spinnerFrame()}
                    branchCollapsed={collapsedSessions().has(entry.sessionID)}
                    onToggle={() => toggleExpanded(entry.id)}
                    onToggleBranch={() => toggleSession(entry.sessionID)}
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
          activity={activity()}
          spinnerFrame={spinnerFrame()}
          initialValue={props.autoSubmitInitial ? "" : props.initialPrompt ?? ""}
        />
      </box>
    </ErrorBoundary>
  )
}

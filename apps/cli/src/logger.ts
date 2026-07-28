// Console renderer for CLI runs: folds the state channel (content) and the loop
// channel (telemetry) into terminal output. Stream text is keyed by the turn's
// assistant message id; `part.delta` carries the part type, so the renderer
// needs no store access and no part bookkeeping beyond the turn header state.
import type { LoopEvent, RuntimeEventBus, StateEvent, ToolDisplay, ToolPart } from "@agent-core"

export type OutputMode = "stream" | "buffered"

type RendererOptions = {
  outputMode: OutputMode
}

type TurnOutput = {
  agent: string
  reasoning: string
  answer: string
}

const MAX_REASONING_LINES = 5

type StreamState = {
  reasoningOpen: boolean
  answerOpen: boolean
}

type OutputRenderer = {
  onReasoning(messageID: string, delta: string, output: TurnOutput): void
  onText(messageID: string, delta: string, output: TurnOutput): void
  flush(messageID: string, output: TurnOutput): void
  detach(outputs: Map<string, TurnOutput>): void
}

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[96m",
  blue: "\x1b[94m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  red: "\x1b[91m",
  gray: "\x1b[90m",
}

function isTTY() {
  return process.stdout.isTTY
}

function style(text: string, ...codes: string[]) {
  if (!isTTY()) return text
  return `${codes.join("")}${text}${ANSI.reset}`
}

function blankLine() {
  process.stdout.write("\n")
}

function printLine(text = "") {
  process.stdout.write(`${text}\n`)
}

function preview(value: unknown, max = 120) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function clipLines(text: string, maxLines: number) {
  const lines = text.trim().split("\n")
  if (lines.length <= maxLines) return lines.join("\n")
  return `${lines.slice(0, maxLines).join("\n")}\n...`
}

function prettyStructuredOutput(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// A tool call renders from the ToolDisplay the tool itself declared. The CLI
// makes its own layout choices here (relative paths, a width cap) but never
// re-derives *what* ran by inspecting arguments — that guesswork drifts the
// moment a tool changes a parameter name.
function formatToolLabel(display: ToolDisplay) {
  const target = display.target ? preview(relativizePath(display.target), 80) : undefined
  return [display.verb, target].filter(Boolean).join(" ")
}

function formatToolResult(display: ToolDisplay) {
  return display.summary ? preview(display.summary, 80) : undefined
}

function relativizePath(value: string) {
  const cwd = process.cwd()
  return value.startsWith(cwd) ? value.slice(cwd.length + 1) || "." : value
}

function printLogo() {
  const lines = [
    `${style("  ___                   _____          _", ANSI.cyan, ANSI.bold)}`,
    `${style(" / _ \\ _ __   ___ _ __| ____|_  _____| |", ANSI.cyan, ANSI.bold)}`,
    `${style("| | | | '_ \\ / _ \\ '__|  _| \\ \/ / _ \\ |", ANSI.blue, ANSI.bold)}`,
    `${style("| |_| | |_) |  __/ |  | |___ >  <  __/ |", ANSI.blue, ANSI.bold)}`,
    `${style(" \\___/| .__/ \\___|_|  |_____/_/\\_\\___|_|", ANSI.green, ANSI.bold)}`,
    `${style("      |_|", ANSI.green, ANSI.bold)} ${style("minimal cli ui", ANSI.dim)}`,
  ]

  blankLine()
  for (const line of lines) {
    printLine(line)
  }
  blankLine()
}

class BufferedOutputRenderer implements OutputRenderer {
  onReasoning() {}

  onText() {}

  flush(_: string, output: TurnOutput) {
    if (output.reasoning.trim()) {
      printLine(style(`Thinking - ${output.agent}`, ANSI.dim, ANSI.bold))
      printLine(clipLines(output.reasoning, MAX_REASONING_LINES))
      blankLine()
    }

    if (output.answer.trim()) {
      printLine(style(`Answer - ${output.agent}`, ANSI.bold))
      printLine(output.answer.trim())
      blankLine()
    }
  }

  detach(outputs: Map<string, TurnOutput>) {
    for (const [messageID, output] of outputs.entries()) {
      this.flush(messageID, output)
    }
  }
}

class StreamingOutputRenderer implements OutputRenderer {
  private states = new Map<string, StreamState>()
  private reasoningLines = new Map<string, number>()

  onReasoning(messageID: string, delta: string, output: TurnOutput) {
    const state = this.getState(messageID)
    if (!state.reasoningOpen) {
      this.closeAnswer(state)
      blankLine()
      printLine(style(`Thinking - ${output.agent}`, ANSI.dim, ANSI.bold))
      state.reasoningOpen = true
    }
    const currentCount = this.reasoningLines.get(messageID) ?? 0
    const nextCount = currentCount + delta.split("\n").length - 1

    if (currentCount < MAX_REASONING_LINES) {
      const lines = delta.split("\n")
      const remaining = MAX_REASONING_LINES - currentCount
      process.stdout.write(lines.slice(0, remaining).join("\n"))
      if (nextCount >= MAX_REASONING_LINES) {
        process.stdout.write("\n...")
      }
    }

    this.reasoningLines.set(messageID, Math.max(currentCount, nextCount))
  }

  onText(messageID: string, delta: string, output: TurnOutput) {
    const state = this.getState(messageID)
    this.closeReasoning(state)
    if (!state.answerOpen) {
      blankLine()
      printLine(style(`Answer - ${output.agent}`, ANSI.bold))
      state.answerOpen = true
    }
    process.stdout.write(delta)
  }

  flush(messageID: string) {
    const state = this.states.get(messageID)
    if (!state) return
    this.closeReasoning(state)
    this.closeAnswer(state)
    this.states.delete(messageID)
    this.reasoningLines.delete(messageID)
  }

  detach() {
    for (const messageID of [...this.states.keys()]) {
      this.flush(messageID)
    }
  }

  private getState(messageID: string) {
    const existing = this.states.get(messageID)
    if (existing) return existing
    const created: StreamState = {
      reasoningOpen: false,
      answerOpen: false,
    }
    this.states.set(messageID, created)
    return created
  }

  private closeReasoning(state: StreamState) {
    if (!state.reasoningOpen) return
    blankLine()
    state.reasoningOpen = false
  }

  private closeAnswer(state: StreamState) {
    if (!state.answerOpen) return
    blankLine()
    state.answerOpen = false
  }
}

class ConsoleLogger {
  private announced = new Set<string>()
  private outputs = new Map<string, TurnOutput>()
  private agents = new Map<string, string>()
  private renderer: OutputRenderer
  private bannerShown = false

  constructor(options: RendererOptions) {
    this.renderer = options.outputMode === "stream" ? new StreamingOutputRenderer() : new BufferedOutputRenderer()
  }

  handleState = (event: StateEvent) => {
    if (event.type === "part.delta") {
      const output = this.getOutput(event.messageID)
      if (event.partType === "reasoning") {
        output.reasoning += event.delta
        this.renderer.onReasoning(event.messageID, event.delta, output)
      } else {
        output.answer += event.delta
        this.renderer.onText(event.messageID, event.delta, output)
      }
      return
    }

    if (event.type === "part.created" && event.part.type === "tool") {
      // Deliberately silent here: part.created only knows the tool's name, and
      // what it is acting on arrives one update later. Announcing now would
      // print "-> task" where "-> subagent general" is the useful line, and a
      // stream cannot go back and fix it.
      return
    }

    if (event.type === "part.updated" && event.part.type === "tool") {
      this.announceTool(event.messageID, event.part)
      this.renderToolState(event.messageID, event.part)
      return
    }

    if (event.type === "message.updated" && event.message.role === "assistant" && event.message.structured !== undefined) {
      this.flush(event.message.id)
      printLine(`${style("[ok]", ANSI.green, ANSI.bold)} structured output captured`)
      printLine(prettyStructuredOutput(event.message.structured))
      blankLine()
      return
    }

    if (event.type === "history.replaced") {
      printLine(`${style("[compact]", ANSI.yellow, ANSI.bold)} compact context`)
    }
  }

  handleLoop = (event: LoopEvent) => {
    if (event.type === "session.start") {
      if (!this.bannerShown) {
        printLogo()
        this.bannerShown = true
      }
      printLine(style(`Session ${event.sessionID}`, ANSI.bold))
      printLine(`${style("Agent", ANSI.gray, ANSI.bold)} ${event.agent}`)
      printLine(`${style("Prompt", ANSI.gray, ANSI.bold)} ${preview(event.text, 160)}`)
      blankLine()
      return
    }

    if (event.type === "turn.start") {
      this.agents.set(event.messageID, event.agent)
      printLine(style(`Step ${event.step} - ${event.agent}`, ANSI.cyan, ANSI.bold))
      return
    }

    if (event.type === "turn.end") {
      this.flush(event.messageID)

      if (event.reason === "abort") {
        printLine(style(`Aborted - ${event.durationMs}ms`, ANSI.red, ANSI.bold))
        blankLine()
        return
      }

      if (event.reason === "error") {
        printLine(style(`Error - ${event.agent}`, ANSI.red, ANSI.bold))
        if (event.error) printLine(style(event.error, ANSI.red))
        blankLine()
        return
      }

      printLine(style(`Done - ${event.finishReason ?? "stop"} - ${event.durationMs}ms - tools ${event.toolCalls}`, ANSI.dim))
      blankLine()
    }
  }

  detach() {
    this.renderer.detach(this.outputs)
    this.outputs.clear()
  }

  // Prints the "->" line once per call, and only once the tool has said what
  // the call is about. The first update is the transition to running, which
  // still carries just the tool's name; the target lands on a later patch. A
  // stream cannot revise a printed line, so it waits for the useful one — and
  // stays quiet for a call that never names a target, since the closing
  // [ok]/[x] line already carries everything such a call has to say.
  private announceTool(messageID: string, part: ToolPart) {
    if (this.announced.has(part.id)) return
    if (part.state.status !== "running" || !part.state.display.target) return

    this.announced.add(part.id)
    this.flush(messageID)
    printLine(`${style("->", ANSI.gray, ANSI.bold)} ${formatToolLabel(part.state.display)}`)
  }

  private renderToolState(messageID: string, part: ToolPart) {
    if (part.state.status === "completed") {
      this.flush(messageID)
      const label = formatToolLabel(part.state.display)
      const suffix = formatToolResult(part.state.display)
      printLine(`${style("[ok]", ANSI.green, ANSI.bold)} ${label}${suffix ? style(` - ${suffix}`, ANSI.dim) : ""}`)
      return
    }

    if (part.state.status === "error") {
      this.flush(messageID)
      printLine(`${style("[x]", ANSI.red, ANSI.bold)} ${formatToolLabel(part.state.display)}`)
      printLine(style(part.state.error.message, ANSI.red))
    }
  }

  private flush(messageID: string) {
    const output = this.outputs.get(messageID)
    if (!output) return
    this.renderer.flush(messageID, output)
    this.outputs.delete(messageID)
  }

  private getOutput(messageID: string) {
    const existing = this.outputs.get(messageID)
    if (existing) return existing
    const created: TurnOutput = {
      agent: this.agents.get(messageID) ?? "agent",
      reasoning: "",
      answer: "",
    }
    this.outputs.set(messageID, created)
    return created
  }
}

export function attachConsoleLogger(events: RuntimeEventBus, options: RendererOptions) {
  const logger = new ConsoleLogger(options)
  const unsubscribeState = events.state.subscribe(logger.handleState)
  const unsubscribeLoop = events.loop.subscribe(logger.handleLoop)
  return () => {
    unsubscribeState()
    unsubscribeLoop()
    logger.detach()
  }
}

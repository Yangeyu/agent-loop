// Console renderer for CLI runs: folds the state channel (content) and the loop
// channel (telemetry) into terminal output. Stream text is keyed by the turn's
// assistant message id; `part.delta` carries the part type, so the renderer
// needs no store access and no part bookkeeping beyond the turn header state.
import type { RuntimeEventBus } from "@harness/runtime/events"
import type { LoopEvent, StateEvent, ToolPart } from "@harness/types"

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

function normalizePath(input: unknown) {
  if (typeof input !== "string" || !input) return undefined
  const cwd = process.cwd()
  return input.startsWith(cwd) ? input.slice(cwd.length + 1) || "." : input
}

function formatToolLabel(tool: string, args: unknown) {
  if (!args || typeof args !== "object") return tool
  const input = args as Record<string, unknown>

  if (tool === "read") {
    const filePath = normalizePath(input.filePath)
    return filePath ? `Read ${filePath}` : "Read file"
  }

  if (tool === "grep") {
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined
    return pattern ? `Search ${JSON.stringify(pattern)}` : "Search"
  }

  if (tool === "glob") {
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined
    return pattern ? `Find ${pattern}` : "Find files"
  }

  if (tool === "bash") {
    const command = typeof input.command === "string" ? input.command : undefined
    return command ? `$ ${command}` : "$ shell"
  }

  if (tool === "task") {
    const subagent = typeof input.subagent_type === "string" ? input.subagent_type : "agent"
    const description = typeof input.description === "string" ? input.description : undefined
    return description ? `Delegate to ${subagent}: ${description}` : `Delegate to ${subagent}`
  }

  if (tool === "task_resume") {
    const subagent = typeof input.subagent_type === "string" ? input.subagent_type : "agent"
    const taskID = typeof input.task_id === "string" ? input.task_id : undefined
    return taskID ? `Resume ${subagent}: ${taskID}` : `Resume ${subagent}`
  }

  if (tool === "batch") {
    const calls = Array.isArray(input.tool_calls) ? input.tool_calls.length : undefined
    return calls ? `Run batch (${calls})` : "Run batch"
  }

  return `${tool} ${preview(args, 80)}`
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
      this.flush(event.messageID)
      printLine(`${style("->", ANSI.gray, ANSI.bold)} ${formatToolLabel(event.part.toolName, event.part.state.input)}`)
      return
    }

    if (event.type === "part.updated" && event.part.type === "tool") {
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

    if (event.type === "turn.input") {
      const tools = event.tools.length > 0 ? event.tools.join(", ") : "<none>"
      printLine(style(`Tools: ${tools}`, ANSI.dim))
      return
    }

    if (event.type === "turn.retry") {
      this.flush(event.messageID)
      const detail = [event.category, event.reason].filter(Boolean).join(" - ")
      printLine(style(`[retry ${event.attempt}] ${event.agent} in ${event.delayMs}ms`, ANSI.yellow, ANSI.bold))
      printLine(style(detail ? `${detail}: ${event.error}` : event.error, ANSI.dim))
      return
    }

    if (event.type === "budget.hit") {
      const usage = event.used !== undefined ? ` (${event.used}/${event.limit})` : ` (${event.limit})`
      printLine(style(`[budget] ${event.agent} ${event.budget}${usage}`, ANSI.yellow, ANSI.bold))
      printLine(style(event.detail, ANSI.dim))
      return
    }

    if (event.type === "turn.outcome") {
      printLine(style(`Outcome - ${event.outcome} - ${event.reason}`, ANSI.dim))
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

  private renderToolState(messageID: string, part: ToolPart) {
    if (part.state.status === "completed") {
      this.flush(messageID)
      const suffix = preview(part.state.output, 80)
      printLine(`${style("[ok]", ANSI.green, ANSI.bold)} ${part.toolName}${suffix ? style(` - ${suffix}`, ANSI.dim) : ""}`)
      return
    }

    if (part.state.status === "error") {
      this.flush(messageID)
      printLine(`${style("[x]", ANSI.red, ANSI.bold)} ${part.toolName}`)
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

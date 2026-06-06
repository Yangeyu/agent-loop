import type { RuntimeEventBus } from "@harness/runtime/events"
import type { RuntimeEvent } from "@harness/runtime/events"

export type OutputMode = "stream" | "buffered"

type RendererOptions = {
  outputMode: OutputMode
}

type TurnOutput = {
  reasoning: string
  answer: string
}

const MAX_REASONING_LINES = 5

type TurnKey = {
  sessionID: string
  agent: string
}

type StreamState = {
  reasoningOpen: boolean
  answerOpen: boolean
}

type OutputRenderer = {
  onReasoning(event: Extract<RuntimeEvent, { type: "reasoning" }>, output: TurnOutput): void
  onText(event: Extract<RuntimeEvent, { type: "text" }>, output: TurnOutput): void
  flush(event: TurnKey, output: TurnOutput): void
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

function toTurnID(key: TurnKey) {
  return `${key.sessionID}:${key.agent}`
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
  onReasoning(_: Extract<RuntimeEvent, { type: "reasoning" }>, output: TurnOutput) {
    void output
  }

  onText(_: Extract<RuntimeEvent, { type: "text" }>, output: TurnOutput) {
    void output
  }

  flush(event: TurnKey, output: TurnOutput) {
    if (output.reasoning.trim()) {
      printLine(style(`Thinking - ${event.agent}`, ANSI.dim, ANSI.bold))
      printLine(clipLines(output.reasoning, MAX_REASONING_LINES))
      blankLine()
    }

    if (output.answer.trim()) {
      printLine(style(`Answer - ${event.agent}`, ANSI.bold))
      printLine(output.answer.trim())
      blankLine()
    }
  }

  detach(outputs: Map<string, TurnOutput>) {
    for (const [turnID, output] of outputs.entries()) {
      const [sessionID, agent] = turnID.split(":")
      if (sessionID && agent) {
        this.flush({ sessionID, agent }, output)
      }
    }
  }
}

class StreamingOutputRenderer implements OutputRenderer {
  private states = new Map<string, StreamState>()
  private reasoningLines = new Map<string, number>()

  onReasoning(event: Extract<RuntimeEvent, { type: "reasoning" }>, output: TurnOutput) {
    void output
    const turnID = toTurnID(event)
    const state = this.getState(event)
    if (!state.reasoningOpen) {
      this.closeAnswer(state)
      blankLine()
      printLine(style(`Thinking - ${event.agent}`, ANSI.dim, ANSI.bold))
      state.reasoningOpen = true
    }
    const nextCount = (this.reasoningLines.get(turnID) ?? 0) + event.textDelta.split("\n").length - 1
    const currentCount = this.reasoningLines.get(turnID) ?? 0

    if (currentCount < MAX_REASONING_LINES) {
      const lines = event.textDelta.split("\n")
      const remaining = MAX_REASONING_LINES - currentCount
      process.stdout.write(lines.slice(0, remaining).join("\n"))
      if (nextCount >= MAX_REASONING_LINES) {
        process.stdout.write("\n...")
      }
    }

    this.reasoningLines.set(turnID, Math.max(currentCount, nextCount))
  }

  onText(event: Extract<RuntimeEvent, { type: "text" }>, output: TurnOutput) {
    void output
    const state = this.getState(event)
    this.closeReasoning(state)
    if (!state.answerOpen) {
      blankLine()
      printLine(style(`Answer - ${event.agent}`, ANSI.bold))
      state.answerOpen = true
    }
    process.stdout.write(event.textDelta)
  }

  flush(event: TurnKey, _: TurnOutput) {
    const state = this.states.get(toTurnID(event))
    if (!state) return
    this.closeReasoning(state)
    this.closeAnswer(state)
    this.states.delete(toTurnID(event))
    this.reasoningLines.delete(toTurnID(event))
  }

  detach(outputs: Map<string, TurnOutput>) {
    void outputs
    for (const [turnID] of this.states.entries()) {
      const [sessionID, agent] = turnID.split(":")
      if (sessionID && agent) {
        this.flush({ sessionID, agent }, { reasoning: "", answer: "" })
      }
    }
  }

  private getState(key: TurnKey) {
    const turnID = toTurnID(key)
    const existing = this.states.get(turnID)
    if (existing) return existing
    const created: StreamState = {
      reasoningOpen: false,
      answerOpen: false,
    }
    this.states.set(turnID, created)
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
  private renderer: OutputRenderer
  private bannerShown = false

  constructor(options: RendererOptions) {
    this.renderer = options.outputMode === "stream" ? new StreamingOutputRenderer() : new BufferedOutputRenderer()
  }

  handle = (event: RuntimeEvent) => {
    if (event.type === "reasoning") {
      const output = this.getOutput(event)
      output.reasoning += event.textDelta
      this.renderer.onReasoning(event, output)
      return
    }

    if (event.type === "text") {
      const output = this.getOutput(event)
      output.answer += event.textDelta
      this.renderer.onText(event, output)
      return
    }

    if ("agent" in event) {
      this.flush(event)
    }

    this.renderMeta(event)
  }

  detach() {
    this.renderer.detach(this.outputs)
    this.outputs.clear()
  }

  private renderMeta(event: RuntimeEvent) {
    if (event.type === "session-start") {
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

    if (event.type === "loop-step") {
      printLine(style(`Step ${event.step} - ${event.agent}`, ANSI.cyan, ANSI.bold))
      return
    }

    if (event.type === "turn-input") {
      const tools = event.tools.length > 0 ? event.tools.join(", ") : "<none>"
      printLine(style(`Tools: ${tools}`, ANSI.dim))
      return
    }

    if (event.type === "retry") {
      const detail = [event.category, event.reason].filter(Boolean).join(" - ")
      printLine(style(`[retry ${event.attempt}] ${event.agent} in ${event.delayMs}ms`, ANSI.yellow, ANSI.bold))
      printLine(style(detail ? `${detail}: ${event.error}` : event.error, ANSI.dim))
      return
    }

    if (event.type === "budget-hit") {
      const usage = event.used !== undefined ? ` (${event.used}/${event.limit})` : ` (${event.limit})`
      printLine(style(`[budget] ${event.agent} ${event.budget}${usage}`, ANSI.yellow, ANSI.bold))
      printLine(style(event.detail, ANSI.dim))
      return
    }

    if (event.type === "tool-start") {
      printLine(`${style("[run]", ANSI.blue, ANSI.bold)} ${event.tool}`)
      return
    }

    if (event.type === "tool-call") {
      printLine(`${style("->", ANSI.gray, ANSI.bold)} ${formatToolLabel(event.tool, event.args)}`)
      return
    }

    if (event.type === "tool-result") {
      const suffix = preview(event.output, 80)
      printLine(`${style("[ok]", ANSI.green, ANSI.bold)} ${event.tool}${suffix ? style(` - ${suffix}`, ANSI.dim) : ""}`)
      return
    }

    if (event.type === "tool-error") {
      printLine(`${style("[x]", ANSI.red, ANSI.bold)} ${event.tool}`)
      printLine(style(event.error, ANSI.red))
      return
    }

    if (event.type === "compaction") {
      printLine(`${style("[compact]", ANSI.yellow, ANSI.bold)} compact context`)
      printLine(style(preview(event.summary, 160), ANSI.dim))
      return
    }

    if (event.type === "structured-output") {
      printLine(`${style("[ok]", ANSI.green, ANSI.bold)} structured output captured`)
      printLine(prettyStructuredOutput(event.output))
      blankLine()
      return
    }

    if (event.type === "turn-outcome") {
      printLine(style(`Outcome - ${event.outcome} - ${event.reason}`, ANSI.dim))
      return
    }

    if (event.type === "turn-complete") {
      printLine(style(`Done - ${event.finishReason} - ${event.durationMs}ms - tools ${event.toolCalls}`, ANSI.dim))
      blankLine()
      return
    }

    if (event.type === "turn-abort") {
      printLine(style(`Aborted - ${event.durationMs}ms`, ANSI.red, ANSI.bold))
      blankLine()
      return
    }

    if (event.type === "error") {
      printLine(style(`Error - ${event.agent}`, ANSI.red, ANSI.bold))
      printLine(style(event.error, ANSI.red))
      blankLine()
      return
    }
  }

  private flush(event: TurnKey) {
    const turnID = toTurnID(event)
    const output = this.outputs.get(turnID)
    if (!output) return
    this.renderer.flush(event, output)
    this.outputs.delete(turnID)
  }

  private getOutput(key: TurnKey) {
    const turnID = toTurnID(key)
    const existing = this.outputs.get(turnID)
    if (existing) return existing
    const created: TurnOutput = {
      reasoning: "",
      answer: "",
    }
    this.outputs.set(turnID, created)
    return created
  }
}

export function attachConsoleLogger(events: RuntimeEventBus, options: RendererOptions) {
  const logger = new ConsoleLogger(options)
  const unsubscribe = events.subscribe(logger.handle)
  return () => {
    unsubscribe()
    logger.detach()
  }
}

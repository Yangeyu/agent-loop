import { createAppRuntime } from "@backend/compose"
import { attachConsoleLogger, runPrompt, type OutputMode } from "@harness"
import { startTui } from "@tui"

function parseArgs(argv: string[]) {
  const args = [...argv]
  let agent: string | undefined
  let json = false
  let sessionID: string | undefined
  let trace = false
  let replayStep: number | undefined
  let replayTurnID: string | undefined
  let tui = false
  let outputMode: OutputMode = "stream"
  let textParts: string[] = []

  while (args.length > 0) {
    const token = args.shift()!
    if (token === "--agent") {
      agent = args.shift() ?? agent
      continue
    }
    if (token === "--json") {
      json = true
      continue
    }
    if (token === "--session") {
      sessionID = args.shift() ?? sessionID
      continue
    }
    if (token === "--trace") {
      trace = true
      continue
    }
    if (token === "--replay-step") {
      const value = args.shift()
      const step = Number(value)
      if (Number.isInteger(step) && step > 0) {
        replayStep = step
        continue
      }
      throw new Error(`Invalid --replay-step value: ${value ?? ""}`)
    }
    if (token === "--replay-turn" || token === "--replay-message") {
      replayTurnID = args.shift() ?? replayTurnID
      continue
    }
    if (token === "--tui") {
      tui = true
      continue
    }
    if (token === "--output") {
      const value = args.shift()
      outputMode = value === "buffered" ? "buffered" : "stream"
      continue
    }
    textParts = [token, ...args]
    break
  }

  return {
    agent,
    json,
    sessionID,
    trace,
    replayStep,
    replayTurnID,
    tui,
    outputMode,
    text: textParts.join(" ").trim(),
  }
}

function validateArgs(parsed: ReturnType<typeof parseArgs>) {
  if (parsed.replayStep !== undefined && parsed.replayTurnID) {
    throw new Error("Use either --replay-step or --replay-turn, not both")
  }

  if (parsed.tui && (parsed.trace || parsed.replayStep !== undefined || parsed.replayTurnID)) {
    throw new Error("Trace and replay debug output are only supported in CLI mode")
  }
}

function printDebugSection(label: string, value: unknown) {
  console.log(`\n[${label}]`)
  console.log(JSON.stringify(value, null, 2))
}

function toReplayDebugSnapshot(runtime: Awaited<ReturnType<typeof createAppRuntime>>, selector: { sessionID: string; step: number } | { sessionID: string; turnID: string }) {
  const replay = runtime.replay.turnInput(selector)
  return {
    sessionID: replay.sessionID,
    messageID: replay.messageID,
    turnID: replay.turnID,
    step: replay.step,
    agent: replay.agent,
    system: replay.system,
    tools: replay.tools,
    messages: replay.messages,
    llmInput: {
      sessionID: replay.llmInput.session.id,
      userID: replay.llmInput.user.id,
      assistantID: replay.llmInput.assistant.id,
      agent: replay.llmInput.agent.name,
      toolIDs: replay.llmInput.tools.map((tool) => tool.id),
      messageCount: replay.llmInput.messages.length,
    },
  }
}

async function main() {
  const runtime = await createAppRuntime()
  const parsed = parseArgs(process.argv.slice(2))
  validateArgs(parsed)
  const defaultAgent = runtime.agent_registry.defaultAgent().name
  const canLaunchTui = process.stdin.isTTY && process.stdout.isTTY

  if (parsed.tui) {
    if (!canLaunchTui) {
      throw new Error("TUI requires an interactive terminal")
    }
    await startTui({
      runtime,
      agent: parsed.agent ?? defaultAgent,
      initialPrompt: parsed.text || undefined,
      autoSubmitInitial: Boolean(parsed.text),
    })
    return
  }

  if (!parsed.text) {
    if (canLaunchTui) {
      await startTui({
        runtime,
        agent: parsed.agent ?? defaultAgent,
      })
      return
    }

    console.log(`Usage: bun run start [--agent ${defaultAgent}] [--session <id>] [--json] [--trace] [--replay-step <n>] [--replay-turn <id>] [--output stream|buffered] "your prompt"`)
    console.log("Example: bun run start \"read src/core/session/prompt.ts and explain the loop\"")
    console.log("Interactive terminals can also launch the TUI with: bun run tui")
    return
  }

  const detach = attachConsoleLogger(runtime.events, { outputMode: parsed.outputMode })
  try {
    const session = await runPrompt({
      runtime,
      text: parsed.text,
      agent: parsed.agent ?? defaultAgent,
      sessionID: parsed.sessionID,
      printSessionJson: parsed.json,
    })

    if (parsed.trace) {
      printDebugSection("trace", runtime.trace.turnsForSession(session.id))
    }

    if (parsed.replayStep !== undefined) {
      printDebugSection("replay", toReplayDebugSnapshot(runtime, {
        sessionID: session.id,
        step: parsed.replayStep,
      }))
    }

    if (parsed.replayTurnID) {
      printDebugSection("replay", toReplayDebugSnapshot(runtime, {
        sessionID: session.id,
        turnID: parsed.replayTurnID,
      }))
    }
  } finally {
    detach()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

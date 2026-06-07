import { createAppRuntime } from "@backend/compose"
import { attachConsoleLogger, runPrompt, type OutputMode } from "@harness"
import { startTui } from "@tui"

function parseArgs(argv: string[]) {
  const args = [...argv]
  let agent: string | undefined
  let json = false
  let sessionID: string | undefined
  let trace = false
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
    tui,
    outputMode,
    text: textParts.join(" ").trim(),
  }
}

function validateArgs(parsed: ReturnType<typeof parseArgs>) {
  if (parsed.tui && parsed.trace) {
    throw new Error("Trace debug output is only supported in CLI mode")
  }
}

function printDebugSection(label: string, value: unknown) {
  console.log(`\n[${label}]`)
  console.log(JSON.stringify(value, null, 2))
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

    console.log(`Usage: bun run start [--agent ${defaultAgent}] [--session <id>] [--json] [--trace] [--output stream|buffered] "your prompt"`)
    console.log("Example: bun run start \"read packages/harness/src/core/loop.ts and explain the loop\"")
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
  } finally {
    detach()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import { createAppRuntime } from "./compose"
import { runPrompt } from "@harness"
import { startTui } from "@tui"
import { attachConsoleLogger, type OutputMode } from "./logger"

function parseArgs(argv: string[]) {
  const args = [...argv]
  let agent: string | undefined
  let json = false
  let sessionID: string | undefined
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
    tui,
    outputMode,
    text: textParts.join(" ").trim(),
  }
}

async function main() {
  const runtime = await createAppRuntime()
  const parsed = parseArgs(process.argv.slice(2))
  const defaultAgent = runtime.agent_registry.defaultAgent().definition.name
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

    console.log(`Usage: bun run start [--agent ${defaultAgent}] [--session <id>] [--json] [--output stream|buffered] "your prompt"`)
    console.log("Example: bun run start \"read packages/harness/src/core/loop.ts and explain the loop\"")
    console.log("Interactive terminals can also launch the TUI with: bun run tui")
    return
  }

  const detach = attachConsoleLogger(runtime.events, { outputMode: parsed.outputMode })
  try {
    await runPrompt({
      runtime,
      text: parsed.text,
      agent: parsed.agent ?? defaultAgent,
      sessionID: parsed.sessionID,
      printSessionJson: parsed.json,
    })
  } finally {
    detach()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

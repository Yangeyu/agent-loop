/// <reference types="bun" />

import { createServer } from "node:net"
import { resolve } from "node:path"

type PipedProcess = Bun.Subprocess<"inherit", "pipe", "pipe">
type InheritedProcess = Bun.Subprocess<"inherit", "inherit", "inherit">

const rootDir = process.cwd()
const frontendDir = resolve(rootDir, "apps/frontend")
const backendHost = "127.0.0.1"
const backendPort = await resolveAvailablePort(4444, 10)

let frontendProcess: InheritedProcess | null = null
let shuttingDown = false

const backendProcess = Bun.spawn(["bun", "--watch", "packages/backend/src/server.ts", "--port", String(backendPort)], {
  cwd: rootDir,
  stdin: "inherit",
  stdout: "pipe",
  stderr: "pipe",
  env: process.env,
})

const ready = createBackendReadyGate(backendProcess)
const backendStdoutPump = pipeOutput(backendProcess.stdout, process.stdout, (text) => {
  const match = text.match(/SSE server listening on (http:\/\/[^\s]+)/)
  if (!match) return
  ready.resolve(match[1])
})
const backendStderrPump = pipeOutput(backendProcess.stderr, process.stderr)

process.on("SIGINT", () => {
  void shutdown(130, "SIGINT")
})

process.on("SIGTERM", () => {
  void shutdown(143, "SIGTERM")
})

try {
  const apiBaseUrl = await ready.promise
  console.log(`Frontend will use ${apiBaseUrl}`)

  frontendProcess = Bun.spawn(["bun", "run", "dev", "--host", "127.0.0.1"], {
    cwd: frontendDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      VITE_API_BASE_URL: apiBaseUrl,
    },
  })

  const exitCode = await Promise.race([
    backendProcess.exited.then((code) => code ?? 0),
    frontendProcess.exited.then((code) => code ?? 0),
  ])

  await shutdown(exitCode)
} catch (error) {
  await shutdown(1)
  console.error(error instanceof Error ? error.message : String(error))
}

await Promise.all([backendStdoutPump, backendStderrPump])

function createBackendReadyGate(proc: PipedProcess) {
  let settled = false
  let resolveReady = (_url: string) => undefined
  let rejectReady = (_error: unknown) => undefined

  const promise = new Promise<string>((resolve, reject) => {
    resolveReady = (url: string) => {
      if (settled) return
      settled = true
      resolve(url)
    }

    rejectReady = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
  })

  proc.exited.then((code) => {
    rejectReady(new Error(`Backend exited before becoming ready (code ${code ?? 0})`))
  })

  return {
    promise,
    resolve: resolveReady,
  }
}

async function pipeOutput(
  stream: ReadableStream<Uint8Array> | null,
  target: NodeJS.WritableStream,
  onText?: (text: string) => void,
) {
  if (!stream) return

  const reader = stream.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })
      target.write(text)
      onText?.(text)
    }

    const tail = decoder.decode()
    if (!tail) return

    target.write(tail)
    onText?.(tail)
  } finally {
    reader.releaseLock()
  }
}

async function shutdown(code: number, signal?: NodeJS.Signals) {
  if (shuttingDown) return
  shuttingDown = true

  tryKill(frontendProcess, signal)
  tryKill(backendProcess, signal)

  await Promise.allSettled([
    frontendProcess?.exited,
    backendProcess.exited,
  ])

  process.exit(code)
}

async function resolveAvailablePort(startPort: number, attempts: number) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset
    if (await canListen(candidate)) return candidate
  }

  throw new Error(`No available backend port found in range ${startPort}-${startPort + attempts - 1}`)
}

function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer()

    server.once("error", () => {
      resolve(false)
    })

    server.listen(port, backendHost, () => {
      server.close(() => resolve(true))
    })
  })
}

function tryKill(proc: PipedProcess | InheritedProcess | null, signal?: NodeJS.Signals) {
  if (!proc || proc.exitCode !== null) return

  try {
    proc.kill(signal)
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

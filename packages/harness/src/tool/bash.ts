import { spawn } from "node:child_process"
import path from "node:path"
import { defineTool } from "@harness/tool/tool"
import { z } from "zod"

export const BashParameters = z.object({
  command: z.string().trim().min(1)
    .describe("The shell command to execute"),
  workdir: z.string().trim().min(1).optional()
    .describe("The working directory to run the command in"),
  timeout: z.number().int().nonnegative().optional()
    .describe("Maximum execution time in milliseconds"),
  description: z.string().trim().min(1).optional()
    .describe("A brief explanation of what this command is doing"),
})

export type BashArgs = z.infer<typeof BashParameters>

export const BashTool = defineTool({
  id: "bash",
  description: "Run a shell command in the local workspace and return stdout, stderr, and exit status.",
  parameters: BashParameters,
  beforeExecute({ args }) {
    const workdir = args.workdir ? path.resolve(process.cwd(), args.workdir) : process.cwd()
    const timeout = args.timeout ?? 120000
    return {
      title: args.description ?? `bash: ${args.command}`,
      metadata: {
        workdir,
        timeout,
      },
    }
  },
  mapError({ toolID, error }) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === "Bash command aborted") {
      return {
        message: `The ${toolID} tool failed: command aborted before completion`,
        retryable: false,
        code: "bash_aborted",
      }
    }

    return {
      message: `The ${toolID} tool failed: ${message}`,
      retryable: false,
      code: "tool_execution_failed",
    }
  },
  async execute(args, ctx) {
    const workdir = args.workdir ? path.resolve(process.cwd(), args.workdir) : process.cwd()
    const timeout = args.timeout ?? 120000

    const result = await runCommand({
      command: args.command,
      workdir,
      timeout,
      abort: ctx.abort,
    })

    return {
      title: args.description ?? `bash: ${args.command}`,
      output: formatOutput(result),
      metadata: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        succeeded: result.exitCode === 0 && !result.timedOut,
        workdir,
        command: args.command,
      },
    }
  },
})

async function runCommand(input: {
  command: string
  workdir: string
  timeout: number
  abort: AbortSignal
}) {
  return await new Promise<{
    stdout: string
    stderr: string
    exitCode: number | null
    timedOut: boolean
  }>((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", input.command], {
      cwd: input.workdir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false

    const cleanup = () => {
      clearTimeout(timer)
      input.abort.removeEventListener("abort", onAbort)
    }

    const finish = (payload: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(payload)
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const onAbort = () => {
      child.kill("SIGTERM")
      fail(new Error("Bash command aborted"))
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, input.timeout)

    input.abort.addEventListener("abort", onAbort, { once: true })

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })

    child.on("error", (error: Error) => {
      fail(error)
    })

    child.on("close", (exitCode: number | null) => {
      finish({ stdout, stderr, exitCode, timedOut })
    })
  })
}

function formatOutput(result: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }) {
  const sections = [`exitCode: ${result.exitCode ?? "null"}`]

  if (result.timedOut) {
    sections.push("timedOut: true")
  }

  if (result.stdout.trim()) {
    sections.push(`stdout:\n${result.stdout.trimEnd()}`)
  }

  if (result.stderr.trim()) {
    sections.push(`stderr:\n${result.stderr.trimEnd()}`)
  }

  if (!result.stdout.trim() && !result.stderr.trim()) {
    sections.push("output: <empty>")
  }

  return sections.join("\n\n")
}

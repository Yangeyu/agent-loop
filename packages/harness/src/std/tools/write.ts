import fs from "node:fs/promises"
import path from "node:path"
import { formatBytes } from "@harness/lib/format"
import { defineTool } from "@harness/tool/tool"
import { z } from "zod"

export const WriteParameters = z.object({
  filePath: z.string().trim().min(1)
    .describe("The path to the file to write. Parent directories are created as needed."),
  content: z.string()
    .describe("The text to write. Written verbatim — no trailing newline is added."),
  mode: z.enum(["overwrite", "append"]).optional()
    .describe("overwrite replaces the file (creating it if absent); append adds to the end. Defaults to overwrite."),
})

export type WriteArgs = z.infer<typeof WriteParameters>

export const WriteTool = defineTool({
  id: "write",
  description:
    "Write text to a local file, either replacing it (overwrite) or adding to its end (append). Reports the file's resulting size, so a large document can be built across several bounded append calls.",
  parameters: WriteParameters,
  beforeExecute({ args }) {
    const target = path.resolve(process.cwd(), args.filePath)
    const mode = args.mode ?? "overwrite"
    return {
      display: {
        verb: "write",
        target,
        // Building one document out of many appends is a single logical
        // operation; keying on the file folds them into one transcript row.
        mergeKey: `write:${target}`,
      },
      metadata: {
        filePath: target,
        mode,
      },
    }
  },
  mapError({ args, toolID, error }) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined
    if (code === "EISDIR") {
      return {
        message: `The ${toolID} tool failed: ${args.filePath} is a directory, not a file`,
        retryable: false,
        code: "write_not_a_file",
      }
    }
    if (code === "EACCES" || code === "EPERM") {
      return {
        message: `The ${toolID} tool failed: permission denied writing ${args.filePath}`,
        retryable: false,
        code: "write_permission_denied",
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      message: `The ${toolID} tool failed: ${message}`,
      retryable: false,
      code: "tool_execution_failed",
    }
  },
  async execute(args) {
    const target = path.resolve(process.cwd(), args.filePath)
    const mode = args.mode ?? "overwrite"

    const existing = await statFile(target)
    if (existing && !existing.isFile()) {
      throw Object.assign(new Error(`${args.filePath} is not a file`), { code: "EISDIR" })
    }

    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, args.content, { encoding: "utf8", flag: mode === "append" ? "a" : "w" })

    const written = Buffer.byteLength(args.content, "utf8")
    const total = (await fs.stat(target)).size

    // The output stays a single line on purpose: the model already holds the
    // content it just sent, so echoing it back would double the context cost of
    // every segment. The running total is the one fact it cannot derive.
    return {
      display: { summary: formatBytes(total) },
      output: `Wrote ${written} bytes (${mode}). ${target} is now ${total} bytes.`,
      metadata: {
        filePath: target,
        mode,
        created: !existing,
        bytesWritten: written,
        totalBytes: total,
      },
    }
  },
})

async function statFile(target: string) {
  try {
    return await fs.stat(target)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

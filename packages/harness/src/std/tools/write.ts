import { formatBytes } from "@harness/lib/format"
import { defineTool } from "@harness/tool/tool"
import { z } from "zod"

const WriteParameters = z.object({
  filePath: z.string().trim().min(1)
    .describe("The path to the file to write. Parent directories are created as needed."),
  content: z.string()
    .describe("The text to write. Written verbatim — no trailing newline is added."),
})


export const WriteTool = defineTool({
  id: "write",
  description:
    "Create a file, or replace one wholesale, with the given text. This discards whatever the file held before, so to change part of an existing file use edit instead. To build a long document, write its complete skeleton once — with a short unique placeholder where each section goes — then fill the sections in with edit.",
  parameters: WriteParameters,
  describe(args, ctx) {
    return { verb: "write", target: ctx.workspace.resolve(args.filePath) }
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
  async execute(args, ctx) {
    const target = ctx.workspace.resolve(args.filePath)
    // Published by rename, so this needs no coordination with anything else
    // running — see workspace/local.ts.
    const written = await ctx.workspace.write(target, args.content)

    // One line, and no metadata block: the model already holds the content it
    // just sent and the arguments it sent them with. Repeating the path and the
    // byte count as JSON would spend context restating what this sentence and
    // the call's own title already say.
    return {
      display: { summary: formatBytes(written.bytes) },
      output: `${written.created ? "Created" : "Replaced"} ${target} (${written.bytes} bytes).`,
    }
  },
})

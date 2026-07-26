import { defineTool, ToolExecutionError } from "@harness/tool/tool"
import type { ToolExecuteResult } from "@harness/types"
import type { WorkspaceChange } from "@harness/workspace"
import { z } from "zod"

// Matches the read tool's ceiling: both are bounded by what can sensibly be
// held as text, and a file one can edit is a file one can read.
const MAX_BYTES = 25 * 1024 * 1024

// Lines of surrounding context returned so the model can confirm the edit
// landed where it meant. Small on purpose — this is a receipt, not the file.
const CONTEXT_LINES = 3

export const EditParameters = z.object({
  filePath: z.string().trim().min(1)
    .describe("The path to the file to edit."),
  oldString: z.string().min(1)
    .describe(
      "The exact text to replace, copied verbatim from the file including indentation. Must appear exactly once unless replaceAll is set.",
    ),
  newString: z.string()
    .describe("The text to put in its place. Empty deletes the matched text."),
  replaceAll: z.boolean().optional()
    .describe("Replace every occurrence instead of requiring exactly one. Defaults to false."),
})

export type EditArgs = z.infer<typeof EditParameters>

export const EditTool = defineTool({
  id: "edit",
  description:
    "Replace an exact snippet of text in an existing file. The snippet must match the file verbatim and appear exactly once, unless replaceAll is set. This is also how a long document is built: write its skeleton first, then replace each placeholder with the real content — every step leaves the file valid, and a placeholder that has gone missing fails loudly instead of appending blindly.",
  parameters: EditParameters,
  describe(args, ctx) {
    return { verb: "edit", target: ctx.workspace.resolve(args.filePath) }
  },
  beforeExecute({ args, ctx }) {
    return {
      metadata: { filePath: ctx.workspace.resolve(args.filePath), replaceAll: args.replaceAll ?? false },
    }
  },
  // Only classifies what execute() could not: execute throws its own refusals
  // (no match, ambiguous, no-op) already typed, and defineTool leaves those
  // alone rather than running them through here.
  mapError({ args, toolID, error }) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        message: `The ${toolID} tool failed: file not found at ${args.filePath}`,
        retryable: false,
        code: "edit_not_found",
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

    if (args.oldString === args.newString) {
      // A no-op edit means the model believes it changed something it did not.
      // Reporting success would let that belief stand.
      throw new ToolExecutionError({
        message: `The edit tool failed: oldString and newString are identical, so this edit would change nothing`,
        retryable: false,
        code: "edit_no_op",
      })
    }

    // A guard, not a precondition: an absent file is left to mutate, whose read
    // raises the ENOENT that mapError turns into edit_not_found.
    const stat = await ctx.workspace.stat(target)
    if (stat && stat.bytes > MAX_BYTES) {
      throw new Error(`file is too large (${stat.bytes} bytes, limit ${MAX_BYTES} bytes)`)
    }

    // The read, the match, and the write are one exclusive step for this path.
    // Two edits to the same file therefore queue instead of both reading the
    // original — and this tool needs to know nothing about the other one.
    return await ctx.workspace.mutate(target, (content) => planEdit(args, target, content))
  },
})

// Pure: given the file's current text, decides the new text and the result to
// report. Every refusal is a throw, and throwing from inside mutate leaves the
// file untouched.
function planEdit(args: EditArgs, target: string, content: string): WorkspaceChange<ToolExecuteResult> {
  const occurrences = countOccurrences(content, args.oldString)

  if (occurrences === 0) throw noMatchError(args, content)
  if (occurrences > 1 && !args.replaceAll) {
    throw new ToolExecutionError({
      message:
        `The edit tool failed: oldString matches ${occurrences} places in ${args.filePath}. ` +
        "Include enough surrounding context to identify one of them, or set replaceAll to change every occurrence.",
      retryable: false,
      code: "edit_not_unique",
    })
  }

  const updated = args.replaceAll
    ? content.split(args.oldString).join(args.newString)
    : content.replace(args.oldString, args.newString)

  const replacements = args.replaceAll ? occurrences : 1
  const firstLine = lineNumberOf(content, content.indexOf(args.oldString))

  return {
    text: updated,
    result: {
      display: { summary: `${replacements} ${replacements === 1 ? "edit" : "edits"}` },
      output: [
        `Replaced ${replacements} occurrence${replacements === 1 ? "" : "s"} in ${target}.`,
        "",
        excerpt(updated, firstLine),
      ].join("\n"),
      metadata: {
        filePath: target,
        replaceAll: args.replaceAll ?? false,
        replacements,
        line: firstLine,
        bytes: Buffer.byteLength(updated, "utf8"),
      },
    },
  }
}

// A failed match is where an edit tool either helps or wastes a turn. Rather
// than silently relaxing the match — which is how a patch lands in the wrong
// place — this reports *why* the exact match failed, so the next attempt can be
// correct rather than a guess. Diagnosing is not applying.
function noMatchError(args: EditArgs, content: string): ToolExecutionError {
  const relaxed = findIgnoringIndentation(content, args.oldString)
  const hint = relaxed === undefined
    ? "The text does not appear in the file; read it and copy the snippet verbatim."
    : `A block at line ${relaxed} matches except for leading whitespace — copy that block's exact indentation.`

  return new ToolExecutionError({
    message: `The edit tool failed: oldString was not found in ${args.filePath}. ${hint}`,
    retryable: false,
    code: "edit_no_match",
  })
}

function countOccurrences(content: string, needle: string) {
  let count = 0
  let index = content.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = content.indexOf(needle, index + needle.length)
  }
  return count
}

// Looks for the snippet with every line's indentation stripped — the single
// most common reason a verbatim copy fails. Returns the 1-based line it starts
// on, for the diagnostic only.
function findIgnoringIndentation(content: string, needle: string) {
  const strip = (text: string) => text.split("\n").map((line) => line.trim())
  const haystack = strip(content)
  const pattern = strip(needle).filter((line, index, all) => !(line === "" && index === all.length - 1))
  if (pattern.length === 0 || pattern.length > haystack.length) return undefined

  for (let start = 0; start <= haystack.length - pattern.length; start += 1) {
    if (pattern.every((line, offset) => haystack[start + offset] === line)) return start + 1
  }
  return undefined
}

function lineNumberOf(content: string, index: number) {
  if (index < 0) return 1
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") line += 1
  }
  return line
}

function excerpt(content: string, aroundLine: number) {
  const lines = content.split("\n")
  const start = Math.max(0, aroundLine - 1 - CONTEXT_LINES)
  const end = Math.min(lines.length, aroundLine + CONTEXT_LINES)
  const width = String(end).length

  return lines
    .slice(start, end)
    .map((line, offset) => `${String(start + offset + 1).padStart(width)} | ${line}`)
    .join("\n")
}

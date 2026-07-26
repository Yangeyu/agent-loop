import path from "node:path"
import { formatBytes } from "@harness/lib/format"
import { defineTool } from "@harness/tool/tool"
import type { Workspace } from "@harness/workspace"
import { z } from "zod"

const DEFAULT_MAX_CHARS = 100_000
const MAX_ALLOWED_CHARS = 500_000
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

// Extensions routed through the office parser; anything else is read as UTF-8
// text directly, so plain files never depend on an extension whitelist.
const DOCUMENT_EXTENSIONS = new Set([
  ".docx",
  ".pptx",
  ".xlsx",
  ".odt",
  ".odp",
  ".ods",
  ".pdf",
  ".rtf",
])

type OfficeFormat = "text" | "md"

type OfficeAst = {
  to(format: OfficeFormat, config?: unknown): Promise<{ value: unknown; messages?: unknown[] }>
}

type OfficeParserModule = {
  parseOffice?: (file: string, config?: unknown) => Promise<OfficeAst>
}

export const ReadParameters = z.object({
  filePath: z.string().trim().min(1)
    .describe("The path to the document or text file to read"),
  format: z.enum(["text", "markdown"]).optional()
    .describe("Output format for document files. Defaults to text."),
  maxChars: z.number().int().min(1).max(MAX_ALLOWED_CHARS).optional()
    .describe("Maximum characters to return. Defaults to 100000."),
})

export type ReadArgs = z.infer<typeof ReadParameters>

export const ReadTool = defineTool({
  id: "read",
  description:
    "Read a local file and return its text content. Reads UTF-8 text files directly, and extracts text from Office/PDF documents such as DOCX, PPTX, XLSX, ODT, ODP, ODS, RTF, and PDF.",
  parameters: ReadParameters,
  describe(args, ctx) {
    return { verb: "read", target: ctx.workspace.resolve(args.filePath) }
  },
  beforeExecute({ args, ctx }) {
    return {
      metadata: {
        filePath: ctx.workspace.resolve(args.filePath),
        format: args.format ?? "text",
      },
    }
  },
  mapError({ args, toolID, error }) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        message: `The ${toolID} tool failed: file not found at ${args.filePath}`,
        retryable: false,
        code: "read_not_found",
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
    const stat = await ctx.workspace.stat(target)
    if (!stat) throw Object.assign(new Error(`file not found at ${args.filePath}`), { code: "ENOENT" })
    if (!stat.isFile) throw new Error(`${args.filePath} is not a file`)
    if (stat.bytes > DEFAULT_MAX_BYTES) {
      throw new Error(`file is too large (${stat.bytes} bytes, limit ${DEFAULT_MAX_BYTES} bytes)`)
    }

    const ext = path.extname(target).toLowerCase()
    const maxChars = args.maxChars ?? DEFAULT_MAX_CHARS
    const requestedFormat = args.format ?? "text"
    const content = await readFileAsText(ctx.workspace, target, ext, requestedFormat, ctx.abort)
    const truncated = truncateText(content.trim(), maxChars)

    return {
      display: {
        summary: truncated.truncated ? `${formatBytes(stat.bytes)}, truncated` : formatBytes(stat.bytes),
      },
      output: truncated.text,
      metadata: {
        filePath: target,
        extension: ext,
        format: requestedFormat,
        bytes: stat.bytes,
        characters: content.length,
        truncated: truncated.truncated,
      },
    }
  },
})

async function readFileAsText(
  workspace: Workspace,
  target: string,
  ext: string,
  format: "text" | "markdown",
  abort: AbortSignal,
) {
  if (!DOCUMENT_EXTENSIONS.has(ext)) return await workspace.readText(target)

  // The office parser opens the path itself, so this one read escapes the
  // workspace. It is safe to leave: reads need no coordination, since writes
  // publish atomically and never expose a half-written file.
  const parseOffice = await loadOfficeParser()
  const outputFormat: OfficeFormat = format === "markdown" ? "md" : "text"
  const ast = await parseOffice(target, {
    abortSignal: abort,
    ignoreInternalLinks: true,
  })
  const result = await ast.to(outputFormat, {
    abortSignal: abort,
    includeImages: false,
    includeCharts: false,
  })

  if (typeof result.value !== "string") {
    throw new Error(`document parser returned non-text output for ${target}`)
  }
  return result.value
}

async function loadOfficeParser() {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>
  let loaded: unknown
  try {
    loaded = await dynamicImport("officeparser")
  } catch (error) {
    throw new Error("officeparser dependency is required to read Office/PDF documents; run bun install", { cause: error })
  }

  const mod = loaded as OfficeParserModule
  if (typeof mod.parseOffice !== "function") {
    throw new Error("officeparser does not expose parseOffice")
  }
  return mod.parseOffice
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) return { text, truncated: false }
  const omitted = text.length - maxChars
  return {
    text: `${text.slice(0, maxChars)}\n\n[truncated ${omitted} characters]`,
    truncated: true,
  }
}

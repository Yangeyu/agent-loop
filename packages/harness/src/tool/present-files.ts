import fs from "node:fs/promises"
import path from "node:path"
import { defineTool } from "@harness/tool/tool"
import { z } from "zod"

export const PresentFilesParameters = z.object({
  paths: z.array(z.string().trim().min(1)).min(1)
    .describe("Workspace-relative or absolute file paths to present in the client"),
  title: z.string().trim().min(1).max(120).optional()
    .describe("Optional artifact title shown in the client UI"),
})

export type PresentFilesArgs = z.infer<typeof PresentFilesParameters>

export const PresentFilesTool = defineTool({
  id: "present_files",
  description: "Present one or more files to the client as a file artifact card.",
  parameters: PresentFilesParameters,
  beforeExecute({ args }) {
    return {
      title: args.title ?? `present_files: ${args.paths.length} file${args.paths.length === 1 ? "" : "s"}`,
      metadata: {
        artifactType: "files",
        fileCount: args.paths.length,
      },
    }
  },
  mapError({ args, toolID, error }) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        message: `The ${toolID} tool failed: file not found while presenting ${args.paths.join(", ")}`,
        retryable: false,
        code: "present_files_not_found",
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
    const files = await Promise.all(args.paths.map(async (item) => {
      const resolved = path.resolve(process.cwd(), item)
      const stat = await fs.stat(resolved)
      const mime = inferMimeType(resolved)
      return {
        path: resolved,
        filename: path.basename(resolved),
        mime,
        bytes: stat.size,
      }
    }))

    return {
      title: args.title ?? `Presented ${files.length} file${files.length === 1 ? "" : "s"}`,
      output: files.length === 1
        ? `Presented 1 file: ${files[0]?.path ?? ""}`
        : `Presented ${files.length} files.`,
      metadata: {
        artifactType: "files",
        title: args.title,
      },
      attachments: files.map((file) => ({
        mime: file.mime,
        filename: file.filename,
        path: file.path,
        bytes: file.bytes,
      })),
    }
  },
})

function inferMimeType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".md":
      return "text/markdown"
    case ".txt":
      return "text/plain"
    case ".json":
      return "application/json"
    case ".pdf":
      return "application/pdf"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".svg":
      return "image/svg+xml"
    case ".csv":
      return "text/csv"
    case ".html":
      return "text/html"
    default:
      return "application/octet-stream"
  }
}

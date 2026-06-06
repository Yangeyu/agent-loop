import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { defineTool } from "@harness/tool/tool"
import { z } from "zod"

// Workspace source roots searched by the grep tool. The repo is a bun monorepo,
// so source lives under packages/* and apps/* (plus dev scripts), not a single src/.
const GREP_SEARCH_DIRS = ["packages", "apps", "scripts"]
const GREP_SKIP = /(^|\/)(node_modules|dist|\.git)(\/|$)/

function resolveGrepRoots() {
  const roots = GREP_SEARCH_DIRS
    .map((dir) => path.resolve(process.cwd(), dir))
    .filter((dir) => existsSync(dir))
  return roots.length > 0 ? roots : [process.cwd()]
}

export const ReadParameters = z.object({
  filePath: z.string().trim().min(1)
    .describe("The path to the file to read"),
})

export type ReadArgs = z.infer<typeof ReadParameters>

export const GrepParameters = z.object({
  pattern: z.string().trim().min(1)
    .describe("The regex pattern to search for in the codebase"),
})

export type GrepArgs = z.infer<typeof GrepParameters>

export const ReadTool = defineTool({
  id: "read",
  description: "Read a UTF-8 text file from the workspace and return its contents.",
  parameters: ReadParameters,
  beforeExecute({ args }) {
    const target = path.resolve(process.cwd(), args.filePath)
    return {
      title: `read: ${args.filePath}`,
      metadata: {
        filePath: target,
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
  async execute(args) {
    const target = path.resolve(process.cwd(), args.filePath)
    const content = await fs.readFile(target, "utf8")
    return {
      output: content,
    }
  },
})

export const GrepTool = defineTool({
  id: "grep",
  description: "Search for a regular expression across TypeScript files in the workspace (packages/ and apps/).",
  parameters: GrepParameters,
  beforeExecute({ args }) {
    const roots = resolveGrepRoots().map((root) => path.relative(process.cwd(), root))
    return {
      title: `grep: ${args.pattern}`,
      metadata: {
        pattern: args.pattern,
        roots,
      },
    }
  },
  mapError({ args, toolID, error }) {
    if (error instanceof SyntaxError) {
      return {
        message: `The ${toolID} tool failed: invalid regular expression ${JSON.stringify(args.pattern)}`,
        retryable: false,
        code: "grep_invalid_pattern",
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
    const roots = resolveGrepRoots()
    const pattern = new RegExp(args.pattern)
    const matches: string[] = []
    let fileCount = 0

    for (const root of roots) {
      const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const absolute = path.join(entry.parentPath ?? root, entry.name)
        const relative = path.relative(process.cwd(), absolute)
        if (!relative.endsWith(".ts") && !relative.endsWith(".tsx")) continue
        if (GREP_SKIP.test(relative)) continue
        fileCount += 1
        const content = await fs.readFile(absolute, "utf8")
        const lines = content.split("\n")
        lines.forEach((line: string, index: number) => {
          pattern.lastIndex = 0
          if (pattern.test(line)) {
            matches.push(`${relative}:${index + 1}: ${line.trim()}`)
          }
        })
      }
    }

    return {
      output: matches.length ? matches.join("\n") : `No matches for ${args.pattern}`,
      metadata: {
        pattern: args.pattern,
        roots: roots.map((root) => path.relative(process.cwd(), root)),
        filesScanned: fileCount,
        matchCount: matches.length,
      },
    }
  },
})

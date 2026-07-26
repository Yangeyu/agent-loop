import path from "node:path"
import { defineTool } from "@harness/tool/tool"
import type { Workspace } from "@harness/workspace"
import { z } from "zod"

// Workspace source roots searched by the grep tool. The repo is a bun monorepo,
// so source lives under packages/* and apps/* (plus dev scripts), not a single src/.
const GREP_SEARCH_DIRS = ["packages", "apps", "scripts"]
const GREP_SKIP = /(^|\/)(node_modules|dist|\.git)(\/|$)/

async function resolveGrepRoots(workspace: Workspace) {
  const candidates = await Promise.all(GREP_SEARCH_DIRS.map(async (dir) => {
    const absolute = workspace.resolve(dir)
    const stat = await workspace.stat(absolute)
    return stat && !stat.isFile ? absolute : undefined
  }))
  const roots = candidates.filter((dir): dir is string => dir !== undefined)
  // A workspace laid out some other way is searched whole rather than not at all.
  return roots.length > 0 ? roots : [workspace.root]
}

export const GrepParameters = z.object({
  pattern: z.string().trim().min(1)
    .describe("The regex pattern to search for in the codebase"),
})

export type GrepArgs = z.infer<typeof GrepParameters>

export const GrepTool = defineTool({
  id: "grep",
  description: "Search for a regular expression across TypeScript files in the workspace (packages/ and apps/).",
  parameters: GrepParameters,
  describe(args) {
    return { verb: "grep", target: args.pattern }
  },
  async beforeExecute({ args, ctx }) {
    const roots = (await resolveGrepRoots(ctx.workspace)).map((root) => ctx.workspace.relative(root))
    return {
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
  async execute(args, ctx) {
    const roots = await resolveGrepRoots(ctx.workspace)
    const pattern = new RegExp(args.pattern)
    const matches: string[] = []
    let fileCount = 0

    for (const root of roots) {
      for (const absolute of await ctx.workspace.listFiles(root)) {
        const relative = ctx.workspace.relative(absolute)
        if (!relative.endsWith(".ts") && !relative.endsWith(".tsx")) continue
        if (GREP_SKIP.test(relative)) continue
        fileCount += 1
        const content = await ctx.workspace.readText(absolute)
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
      display: {
        summary: matches.length ? `${matches.length} in ${fileCount} files` : "no matches",
      },
      output: matches.length ? matches.join("\n") : `No matches for ${args.pattern}`,
      metadata: {
        pattern: args.pattern,
        roots: roots.map((root) => ctx.workspace.relative(root)),
        filesScanned: fileCount,
        matchCount: matches.length,
      },
    }
  },
})

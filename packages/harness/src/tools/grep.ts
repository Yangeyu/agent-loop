import { defineTool } from "@agent-core"
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

const GrepParameters = z.object({
  pattern: z.string().trim().min(1)
    .describe("The regex pattern to search for in the codebase"),
})

/** Builds the grep tool bound to a workspace. */
export function createGrepTool(deps: { workspace: Workspace }) {
  return defineTool({
    id: "grep",
    description: "Search for a regular expression across TypeScript files in the workspace (packages/ and apps/).",
    parameters: GrepParameters,
    describe(args) {
      return { verb: "grep", target: args.pattern }
    },
    async beforeExecute() {
      const roots = (await resolveGrepRoots(deps.workspace)).map((root) => deps.workspace.relative(root))
      // The roots are the one fact the caller cannot derive: which directories
      // this tool decided to search.
      return { metadata: { roots } }
    },
    mapError({ args, toolID, error }) {
      if (error instanceof SyntaxError) {
        return {
          message: `The ${toolID} tool failed: invalid regular expression ${JSON.stringify(args.pattern)}`,
          retryable: false,
          code: "grep_invalid_pattern",
        }
      }
    },
    async execute(args) {
      const roots = await resolveGrepRoots(deps.workspace)
      const pattern = new RegExp(args.pattern)
      const matches: string[] = []
      let fileCount = 0

      for (const root of roots) {
        for (const absolute of await deps.workspace.listFiles(root, { recursive: true })) {
          const relative = deps.workspace.relative(absolute)
          if (!relative.endsWith(".ts") && !relative.endsWith(".tsx")) continue
          if (GREP_SKIP.test(relative)) continue
          fileCount += 1
          const content = await deps.workspace.readText(absolute)
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
          roots: roots.map((root) => deps.workspace.relative(root)),
          filesScanned: fileCount,
          matchCount: matches.length,
        },
      }
    },
  })
}

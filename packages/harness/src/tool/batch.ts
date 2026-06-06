import { defineTool } from "@harness/tool/tool"
import { z } from "zod"

export const BatchParameters = z.object({
  tool_calls: z
    .array(
      z.object({
        tool: z.string().trim().min(1)
          .describe("The name of the tool to call"),
        parameters: z.record(z.string(), z.unknown())
          .describe("The arguments to pass to the tool"),
      }),
    )
    .min(1)
    .describe("A list of tool calls to execute in parallel"),
})

export type BatchArgs = z.infer<typeof BatchParameters>

export const BatchTool = defineTool({
  id: "batch",
  description: "Run multiple independent tool calls in parallel and aggregate their outputs.",
  parameters: BatchParameters,
  beforeExecute({ args }) {
    return {
      title: "Batch execution",
      metadata: {
        count: args.tool_calls.length,
        tools: args.tool_calls.map((call) => call.tool),
      },
    }
  },
  async execute(args, ctx) {
    const results = await Promise.all(
      args.tool_calls.map(async (call) => {
        const result = await ctx.executeTool({
          toolName: call.tool,
          args: call.parameters,
        })

        if (result.status === "error") {
          return {
            tool: call.tool,
            output: `[error] ${result.error.message}`,
          }
        }

        return {
          tool: call.tool,
          output: result.result.output,
        }
      }),
    )

    return {
      title: "Batch execution",
      output: results.map((result) => `[${result.tool}]\n${result.output}`).join("\n\n"),
      metadata: {
        count: results.length,
        tools: args.tool_calls.map((call) => call.tool),
      },
    }
  },
})

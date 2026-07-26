import { describe, expect, it } from "bun:test"
import { createToolContext } from "../support/tool-context"
import { defineTool, ToolExecutionError } from "@harness/tool/tool"
import { z } from "zod"

const NoArgs = z.object({})

describe("defineTool error classification", () => {
  it("keeps a failure the tool classified itself, even when mapError is defined", async () => {
    const tool = defineTool({
      id: "picky",
      description: "throws an already-classified failure",
      parameters: NoArgs,
      mapError: ({ toolID }) => ({ message: `${toolID} failed`, retryable: false, code: "generic" }),
      async execute() {
        throw new ToolExecutionError({ message: "matched 3 places", retryable: false, code: "not_unique" })
      },
    })

    // mapError is for what the tool could not classify; relabelling a typed
    // refusal as "generic" would throw away the code that says how to fix it.
    await expect(tool.execute({}, createToolContext())).rejects.toMatchObject({
      info: { code: "not_unique", message: "matched 3 places" },
    })
  })

  it("classifies an unclassified failure through mapError", async () => {
    const tool = defineTool({
      id: "raw",
      description: "throws a bare error",
      parameters: NoArgs,
      mapError: ({ error }) => ({
        message: `mapped: ${error instanceof Error ? error.message : ""}`,
        retryable: true,
        code: "mapped",
      }),
      async execute() {
        throw new Error("something from a library")
      },
    })

    await expect(tool.execute({}, createToolContext())).rejects.toMatchObject({
      info: { code: "mapped", retryable: true },
    })
  })

  it("falls back to a generic execution failure without mapError", async () => {
    const tool = defineTool({
      id: "plain",
      description: "throws a bare error and defines no mapError",
      parameters: NoArgs,
      async execute() {
        throw new Error("boom")
      },
    })

    await expect(tool.execute({}, createToolContext())).rejects.toMatchObject({
      info: { code: "tool_execution_failed" },
    })
  })

  it("preserves a self-classified failure with no mapError too, so the two paths agree", async () => {
    const tool = defineTool({
      id: "picky-plain",
      description: "throws an already-classified failure and defines no mapError",
      parameters: NoArgs,
      async execute() {
        throw new ToolExecutionError({ message: "no match", retryable: false, code: "no_match" })
      },
    })

    await expect(tool.execute({}, createToolContext())).rejects.toMatchObject({
      info: { code: "no_match" },
    })
  })
})

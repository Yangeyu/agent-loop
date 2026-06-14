import { describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { baseMiddleware, createDashScopeModel, createTestRuntime, defineAgent, runPrompt } from "@harness"
import { ReadTool } from "@harness/tool/basic"
import type { ToolPart } from "@harness/types"

// End-to-end against the real configured model (DashScope). Skipped when no API
// key is present so the default suite never depends on the network.
const live = it.skipIf(!process.env.DASHSCOPE_API_KEY)

describe("parallel tools (e2e)", () => {
  live(
    "asks the real model to read two files and gets both contents back",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "parallel-tools-"))
      const fileA = join(dir, "a.txt")
      const fileB = join(dir, "b.txt")
      writeFileSync(fileA, "the secret word in A is sapphire")
      writeFileSync(fileB, "the secret word in B is marigold")

      // A minimal agent with only `read`, driven by the real model: the e2e is
      // the model itself choosing to fan out two real reads through the loop.
      const agent = defineAgent({
        name: "reader",
        mode: "primary",
        model: createDashScopeModel({ modelID: "qwen3.7-plus" }),
        tools: { read: true },
        middleware: baseMiddleware(),
      })
      const runtime = await createTestRuntime({
        plugins: [{ name: "test", agents: [agent], tools: [ReadTool] }],
      })

      const session = await runPrompt({
        runtime,
        agent: "reader",
        text: `Read both files ${fileA} and ${fileB}, then tell me the secret word in each.`,
      })

      const readOutputs = session.messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => runtime.sessions.parts(session.id, message.id))
        .filter((part): part is ToolPart => part.type === "tool" && part.toolName === "read")
        .map((part) => (part.state.status === "completed" ? part.state.output : ""))
        .join("\n")

      expect(readOutputs).toContain("sapphire")
      expect(readOutputs).toContain("marigold")
    },
    60_000,
  )
})

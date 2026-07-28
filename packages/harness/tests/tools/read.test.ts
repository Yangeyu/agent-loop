import { describe, expect, it } from "bun:test"
import { createToolContext } from "@agent-core"
import { createReadTool } from "@harness/tools/read"
import { createWorkspace } from "@harness/workspace"

const ReadTool = createReadTool({ workspace: createWorkspace() })

describe("read", () => {
  it("reads UTF-8 text files with metadata", async () => {
    const file = new File(["hello\nworld"], "sample.txt", { type: "text/plain" })
    const target = await Bun.write(Bun.file("/tmp/agent-loop-read-file-test.txt"), file)
    expect(target).toBe(11)

    const result = await ReadTool.execute({ filePath: "/tmp/agent-loop-read-file-test.txt" }, createToolContext())

    expect(result.output).toBe("hello\nworld")
    // truncated is what the model must be able to trust: false means the output
    // above really is the whole file.
    expect(result.metadata?.truncated).toBe(false)
    expect(result.metadata?.bytes).toBe(11)
  })
})

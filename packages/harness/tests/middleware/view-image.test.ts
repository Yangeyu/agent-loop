import { describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { viewImage } from "@harness/middleware/view-image"
import type { HookContext } from "@agent-core/hooks"
import type { ModelMessage } from "@agent-core/llm/types"

const assemble = viewImage().beforeModelCall!
// The middleware only reads ctx.model.spec.capabilities.vision; stub a vision model.
const ctx = { model: { spec: { capabilities: { vision: true } } } } as unknown as HookContext

async function transform(context: HookContext, messages: ModelMessage[]) {
  const draft = await assemble(context, { system: [], messages })
  return draft.messages
}

describe("view-image middleware", () => {
  it("reads a local file source and base64-encodes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "view-image-"))
    const file = join(dir, "a.png")
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    writeFileSync(file, bytes)

    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "image", source: { kind: "file", path: file, mime: "image/png" } }] },
    ]

    const out = await transform(ctx, messages)
    const block = out[0].content[0]
    if (block.type !== "image") throw new Error("expected image block")
    expect(block.source).toEqual({ kind: "base64", data: bytes.toString("base64"), mime: "image/png" })
  })

  it("passes base64 and url sources through without rebuilding the message", async () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", source: { kind: "url", url: "https://example.com/a.png" } },
          { type: "text", text: "hi" },
        ],
      },
    ]

    const out = await transform(ctx, messages)
    expect(out[0]).toBe(messages[0]) // unchanged messages keep identity
  })
})

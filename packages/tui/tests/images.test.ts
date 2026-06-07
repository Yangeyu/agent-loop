import { describe, expect, it } from "bun:test"
import path from "node:path"
import { decodeClipboardPngData, parseInlineImageAttachments } from "@tui/images"

describe("parseInlineImageAttachments", () => {
  it("extracts local image paths and removes inline attachment tokens from prompt text", () => {
    const result = parseInlineImageAttachments("please inspect @screenshots/a.png and summarize")

    expect(result.text).toBe("please inspect and summarize")
    expect(result.images).toHaveLength(1)
    expect(result.images[0].origin).toBe("inline")
    expect(result.images[0].label).toBe(path.join("screenshots", "a.png"))
    expect(result.images[0].source).toEqual({
      kind: "file",
      path: path.resolve(process.cwd(), "screenshots/a.png"),
      mime: "image/png",
    })
  })

  it("supports quoted paths with spaces and remote urls", () => {
    const result = parseInlineImageAttachments('look @"assets/my shot.png" and @https://example.com/a.png')

    expect(result.text).toBe("look and")
    expect(result.images).toHaveLength(2)
    expect(result.images[0].source).toEqual({
      kind: "file",
      path: path.resolve(process.cwd(), "assets/my shot.png"),
      mime: "image/png",
    })
    expect(result.images[1].source).toEqual({ kind: "url", url: "https://example.com/a.png" })
  })

  it("leaves non-image @tokens untouched", () => {
    const result = parseInlineImageAttachments("check @general and note.txt before @docs/readme.md")

    expect(result.text).toBe("check @general and note.txt before @docs/readme.md")
    expect(result.images).toHaveLength(0)
  })
})

describe("decodeClipboardPngData", () => {
  it("decodes AppleScript clipboard PNG payloads", () => {
    const bytes = decodeClipboardPngData("«data PNGf89504E47»")
    expect(bytes).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it("returns undefined for invalid clipboard payloads", () => {
    expect(decodeClipboardPngData("plain text")).toBeUndefined()
  })
})

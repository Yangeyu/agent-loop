import type { ImageSource } from "@harness"
import { spawnSync } from "node:child_process"
import path from "node:path"

export type ComposerImageAttachment = {
  id: string
  source: ImageSource
  label: string
  origin: "inline" | "clipboard"
}

const IMAGE_EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

export function parseInlineImageAttachments(input: string): {
  text: string
  images: ComposerImageAttachment[]
} {
  const images: ComposerImageAttachment[] = []
  const text = input.replace(/(^|\s)(@(?:"[^"]+"|'[^']+'|\S+))/g, (full, prefix: string, token: string) => {
    const candidate = normalizeImageToken(token.slice(1))
    const source = candidate ? toImageSource(candidate) : undefined
    if (!source) return full

    images.push({
      id: createLocalID(),
      source,
      label: buildAttachmentLabel(source),
      origin: "inline",
    })
    return prefix
  })

  return {
    text: text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    images,
  }
}

export function loadClipboardImage(): {
  ok: true
  attachment: ComposerImageAttachment
} | {
  ok: false
  error: string
} {
  if (process.platform !== "darwin") {
    return { ok: false, error: "Clipboard image paste is currently supported on macOS only" }
  }

  const result = spawnSync("osascript", ["-e", "the clipboard as «class PNGf»"], {
    encoding: "utf8",
  })

  if (result.status !== 0) {
    return { ok: false, error: "Clipboard does not currently contain a PNG image" }
  }

  const bytes = decodeClipboardPngData(result.stdout)
  if (!bytes) {
    return { ok: false, error: "Failed to decode clipboard image data" }
  }

  return {
    ok: true,
    attachment: {
      id: createLocalID(),
      source: { kind: "base64", data: bytes.toString("base64"), mime: "image/png" },
      label: `clipboard-${createLocalID()}.png`,
      origin: "clipboard",
    },
  }
}

function normalizeImageToken(input: string) {
  const trimmed = input.trim()
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function decodeClipboardPngData(value: string) {
  const match = value.match(/«data PNGf([0-9A-Fa-f]+)»/)
  if (!match) return undefined
  return Buffer.from(match[1], "hex")
}

function toImageSource(input: string): ImageSource | undefined {
  if (/^https?:\/\//i.test(input)) return { kind: "url", url: input }

  const resolved = path.resolve(process.cwd(), input)
  const mime = IMAGE_EXT_MIME[path.extname(resolved).toLowerCase()]
  if (!mime) return undefined

  return { kind: "file", path: resolved, mime }
}

function buildAttachmentLabel(source: ImageSource) {
  if (source.kind === "url") return source.url
  if (source.kind === "file") return path.relative(process.cwd(), source.path) || path.basename(source.path)
  return "clipboard.png"
}

function createLocalID() {
  return Math.random().toString(36).slice(2, 10)
}

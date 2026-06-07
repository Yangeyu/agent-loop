// Image source resolution shared by the passthrough path (view-image middleware)
// and the agent-initiated path (view_image tool). The qwen vision API accepts an
// image only as a remote URL or a base64 data URL, so a local `file` source must
// be read off disk and encoded before it can reach the provider.
import { readFile } from "node:fs/promises"
import type { ImageSource } from "@harness/types"

// Resolve a source into a provider-ready form: a local file is read and base64
// encoded; `base64` (e.g. a pasted screenshot) and `url` are passed through.
export async function resolveImageSource(source: ImageSource): Promise<ImageSource> {
  if (source.kind !== "file") return source
  const data = (await readFile(source.path)).toString("base64")
  return { kind: "base64", data, mime: source.mime }
}

// Map a resolved source to the qwen `image_url.url` string. A `file` source must
// be resolved first (via resolveImageSource); reaching here is a programmer error.
export function imageSourceToUrl(source: ImageSource): string {
  if (source.kind === "url") return source.url
  if (source.kind === "base64") return `data:${source.mime};base64,${source.data}`
  throw new Error("Unresolved file image source reached the provider; call resolveImageSource first")
}

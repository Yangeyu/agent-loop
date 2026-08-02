/**
 * Image source resolution shared by the passthrough path (view-image middleware)
 * and the agent-initiated path (view_image tool). The vision API accepts an image
 * only as a remote URL or a base64 data URL, so a local `file` source must be read
 * off disk and encoded before it can reach the provider.
 */
import { readFile } from "node:fs/promises"
import type { ImageSource } from "@agent-core"

/**
 * Resolves a source into a provider-ready form: a local file is read and base64
 * encoded; `base64` (e.g. a pasted screenshot) and `url` are passed through.
 *
 * @param source - the raw image source from a message or tool
 * @returns a source the provider can consume directly (`base64` or `url`)
 */
export async function resolveImageSource(source: ImageSource): Promise<ImageSource> {
  if (source.kind !== "file") return source
  const data = (await readFile(source.path)).toString("base64")
  return { kind: "base64", data, mime: source.mime }
}

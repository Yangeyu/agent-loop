/**
 * Image source resolution shared by the passthrough path (view-image middleware)
 * and the agent-initiated path (view_image tool). The vision API accepts an image
 * only as a remote URL or a base64 data URL, so a local `file` source must be read
 * off disk and encoded before it can reach the provider.
 */
import { readFile } from "node:fs/promises"
import type { ImageSource } from "@harness/types"

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

/**
 * Maps a resolved source to the `image_url.url` string the provider expects.
 *
 * @param source - a resolved image source (`url` or `base64`)
 * @returns the URL string (a remote URL, or a base64 data URL)
 * @throws if given an unresolved `file` source — call resolveImageSource first
 */
export function imageSourceToUrl(source: ImageSource): string {
  if (source.kind === "url") return source.url
  if (source.kind === "base64") return `data:${source.mime};base64,${source.data}`
  throw new Error("Unresolved file image source reached the provider; call resolveImageSource first")
}

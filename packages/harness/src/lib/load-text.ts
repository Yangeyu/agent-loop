import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export function loadText(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8").trim()
}

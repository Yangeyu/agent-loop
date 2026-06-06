/// <reference types="bun" />

import solidPlugin from "@opentui/solid/bun-plugin"
import { rmSync } from "node:fs"

rmSync("dist", { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["./apps/cli/src/index.ts"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  sourcemap: "linked",
  plugins: [solidPlugin],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

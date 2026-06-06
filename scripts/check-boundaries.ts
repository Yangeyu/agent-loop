/// <reference types="bun" />

// Enforces the monorepo dependency direction (see docs/monorepo-migration-plan.md):
//   surfaces -> harness (one-way). The engine never depends on a surface, and the
//   browser frontend never imports server/engine runtime code.
import { Glob } from "bun"
import { readFileSync } from "node:fs"

type Rule = {
  pkg: string
  dir: string
  forbid: RegExp
  why: string
}

const rules: Rule[] = [
  {
    pkg: "harness",
    dir: "packages/harness/src",
    forbid: /from\s+["']@(backend|tui|contracts)(\/|["'])/,
    why: "harness is the engine: it must not depend on any surface (backend/tui) or contracts",
  },
  {
    pkg: "contracts",
    dir: "packages/contracts/src",
    forbid: /from\s+["']@(harness|backend|tui)(\/|["'])/,
    why: "contracts is a pure wire-type leaf: it must not import any other workspace package",
  },
  {
    pkg: "frontend",
    dir: "apps/frontend/src",
    forbid: /from\s+["'](@harness|@backend|@tui|@agent-loop\/(harness|backend|tui))(\/|["'])/,
    why: "frontend runs in the browser: it may only import @agent-loop/contracts, never engine/server code",
  },
  // Consume the harness only through its public barrel ("@harness"), never deep
  // internal paths ("@harness/..."), so the engine keeps a curated public contract.
  ...["packages/backend/src", "packages/tui/src", "apps/cli/src"].map((dir) => ({
    pkg: dir.split("/")[1],
    dir,
    forbid: /from\s+["']@harness\//,
    why: 'import the harness via its barrel ("@harness"), not deep paths ("@harness/...") — add to the barrel if a symbol is missing',
  })),
]

let violations = 0

for (const rule of rules) {
  const glob = new Glob("**/*.{ts,tsx}")
  for (const file of glob.scanSync(rule.dir)) {
    const path = `${rule.dir}/${file}`
    const lines = readFileSync(path, "utf8").split("\n")
    lines.forEach((line, i) => {
      if (rule.forbid.test(line)) {
        violations++
        console.error(`✗ [${rule.pkg}] ${path}:${i + 1}\n    ${line.trim()}\n    ${rule.why}`)
      }
    })
  }
}

if (violations > 0) {
  console.error(`\n${violations} boundary violation(s) found.`)
  process.exit(1)
}

console.log("✓ dependency boundaries OK")

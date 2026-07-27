/// <reference types="bun" />

// Enforces the monorepo dependency direction:
//   agent-core <- harness <- surfaces (one-way). agent-core is the general agent
//   loop; harness orchestrates it into a working coding agent; surfaces (tui,
//   cli) drive the harness. Nothing below ever depends on something above.
import { Glob } from "bun"
import { readFileSync } from "node:fs"

type Rule = {
  pkg: string
  dir: string
  // Restricts the rule to one file inside `dir`; omitted means every file.
  file?: string
  forbid: RegExp
  why: string
}

const rules: Rule[] = [
  // The data model is the pure leaf: it is the sole basis on which an event
  // consumer rebuilds state, so it may import nothing at all.
  {
    pkg: "agent-core-model",
    dir: "packages/agent-core/src",
    file: "model.ts",
    forbid: /from\s+["'](?!\.)/,
    why: "the data model must depend on nothing — it is what a consumer folds events into",
  },
  {
    pkg: "agent-core",
    dir: "packages/agent-core/src",
    forbid: /from\s+["']@(harness|tui)(\/|["'])/,
    why: "agent-core is the general loop: it must not know about orchestration (skills, workspace, multiple agents) or any surface",
  },
  {
    pkg: "harness",
    dir: "packages/harness/src",
    forbid: /from\s+["']@tui(\/|["'])/,
    why: "harness is the engine side: it must not depend on any surface (tui/cli)",
  },
  // Consume each package only through its public barrel, never deep internal
  // paths, so both keep a curated public contract.
  ...["packages/tui/src", "apps/cli/src"].map((dir) => ({
    pkg: dir.split("/")[1],
    dir,
    forbid: /from\s+["']@(harness|agent-core)\//,
    why: 'import via the package barrel ("@harness" / "@agent-core"), not deep paths — add to the barrel if a symbol is missing',
  })),
  {
    pkg: "harness",
    dir: "packages/harness/src",
    forbid: /from\s+["']@agent-core\//,
    why: 'import the loop via its barrel ("@agent-core"), not deep paths',
  },
]

let violations = 0

for (const rule of rules) {
  const glob = new Glob(rule.file ?? "**/*.{ts,tsx}")
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

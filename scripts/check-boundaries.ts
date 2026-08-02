/// <reference types="bun" />

/**
 * Enforces the monorepo dependency direction:
 *   agent-core <- harness <- surfaces (one-way), with providers beside harness:
 *   agent-core is the general agent loop; providers bind its Model port to
 *   vendors; harness orchestrates the loop into a working coding agent;
 *   surfaces (tui, cli) drive the harness and inject provider models. Nothing
 *   below ever depends on something above, and nothing but a composition root
 *   (or an e2e suite) depends on providers.
 */
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
    forbid: /from\s+["']@(harness|tui|providers)(\/|["'])/,
    why: "agent-core is the general loop: it must not know about orchestration, any surface, or any concrete provider — models arrive as injected instances",
  },
  // engine/ is the sealed machine room: the barrel never re-exports it, so no
  // consumer of "@agent-core" can reach the loop machinery.
  {
    pkg: "agent-core-barrel",
    dir: "packages/agent-core/src",
    file: "index.ts",
    forbid: /@agent-core\/engine/,
    why: "engine/ is implementation, not API — nothing in it belongs on the public surface",
  },
  // Core tests prove the package stands alone; a test reaching for @harness is
  // an integration test and belongs in packages/harness/tests.
  {
    pkg: "agent-core-tests",
    dir: "packages/agent-core/tests",
    forbid: /from\s+["']@(harness|tui|providers)(\/|["'])/,
    why: "agent-core tests must run on the package alone — use the shipped fakes; a test needing the harness or a live provider lives in that package",
  },
  {
    pkg: "harness",
    dir: "packages/harness/src",
    forbid: /from\s+["']@(tui|providers)(\/|["'])/,
    why: "harness is the engine side: no surface (tui/cli), and no concrete provider — models are injected by the composition root",
  },
  // Unit tests run on fakes; only e2e suites (packages/harness/e2e) may bind a
  // live provider.
  {
    pkg: "harness-tests",
    dir: "packages/harness/tests",
    forbid: /from\s+["']@providers(\/|["'])/,
    why: "harness unit tests run on the shipped fakes — a test needing a live provider is an e2e test and lives in packages/harness/e2e",
  },
  {
    pkg: "providers",
    dir: "packages/providers/src",
    forbid: /from\s+["']@(harness|tui)(\/|["'])/,
    why: "providers bind the Model port and nothing else: they must not know about orchestration or any surface",
  },
  {
    pkg: "providers",
    dir: "packages/providers/src",
    forbid: /from\s+["']@agent-core\//,
    why: 'import the loop via its barrel ("@agent-core"), not deep paths — the port surface is the contract',
  },
  // Consume each package only through its public barrel, never deep internal
  // paths, so both keep a curated public contract.
  ...["packages/tui/src", "apps/cli/src"].map((dir) => ({
    pkg: dir.split("/")[1],
    dir,
    forbid: /from\s+["']@(harness|agent-core|providers)\//,
    why: 'import via the package barrel ("@harness" / "@agent-core" / "@providers"), not deep paths — add to the barrel if a symbol is missing',
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

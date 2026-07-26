/// <reference types="bun" />

// Enforces the monorepo dependency direction:
//   contracts <- harness <- surfaces (one-way). Contracts is the pure shared
//   leaf (data model + event vocabulary); the harness builds on it; surfaces
//   (tui, cli) build on the harness. The engine never depends on a surface.
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
    forbid: /from\s+["']@tui(\/|["'])/,
    why: "harness is the engine: it must not depend on any surface (tui/cli)",
  },
  {
    pkg: "contracts",
    dir: "packages/contracts/src",
    forbid: /from\s+["']@(harness|tui)(\/|["'])/,
    why: "contracts is a pure wire-type leaf: it must not import any other workspace package",
  },
  // Consume the harness only through its public barrel ("@harness"), never deep
  // internal paths ("@harness/..."), so the engine keeps a curated public contract.
  ...["packages/tui/src", "apps/cli/src"].map((dir) => ({
    pkg: dir.split("/")[1],
    dir,
    forbid: /from\s+["']@harness\//,
    why: 'import the harness via its barrel ("@harness"), not deep paths ("@harness/...") — add to the barrel if a symbol is missing',
  })),
  // Layering inside the harness — a straight line, outward only:
  //   contracts <- substrate (event/llm/session/tool/skill contracts, lib)
  //             <- agent (the kernel atom) <- std (bricks) <- runtime <- surfaces.
  //
  // The agent kernel may use the substrate and its own files — never the std
  // brick layer (middleware, concrete agents/tools) or the composition layer
  // (runtime). Behavior enters the kernel through hook/blueprint contracts,
  // not imports.
  {
    pkg: "harness-kernel",
    dir: "packages/harness/src/agent",
    forbid: /from\s+["']@harness\/(std\/|runtime\/)/,
    why: "the agent kernel must not import std bricks or the runtime composition layer — extend via hooks/blueprints instead",
  },
  // The substrate (bus, model port, session state, tool/skill contracts) sits
  // below the kernel: it must not reach up into agent/std/runtime.
  ...["event", "llm", "session", "tool", "skill", "lib"].map((name) => ({
    pkg: "harness-substrate",
    dir: `packages/harness/src/${name}`,
    forbid: /from\s+["']@harness\/(agent\/|std\/|runtime\/)/,
    why: "the substrate must not depend on the kernel, std bricks, or runtime — it is what those layers build on",
  })),
  // Std bricks compose kernel + substrate; only runtime assembles them.
  {
    pkg: "harness-std",
    dir: "packages/harness/src/std",
    forbid: /from\s+["']@harness\/runtime\//,
    why: "std bricks must not depend on the runtime composition layer — runtime assembles std, not the reverse",
  },
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

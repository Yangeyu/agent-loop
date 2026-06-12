# AGENTS.md

A compact TypeScript agent runtime (Bun workspaces) that captures OpenCode's core
behavior: an agentic loop with tool execution, subagent delegation, session state,
provider adaptation, and compaction — not a full product clone.

This file is the entry point: the core constraints below are non-negotiable; the
**Doc Map** routes you to the right document before you read source.

## Core Constraints

- **Aliases, not relative paths.** Cross-package and internal imports use per-package
  aliases (`@harness/*`, `@backend/*`, `@tui/*`, `@contracts`), registered in
  `tsconfig.base.json`. Never reintroduce a shared `@/` alias; never add `.js` suffixes.
- **One-way dependencies.** `contracts <- harness <- surfaces` (cli/backend/tui).
  Contracts is the pure shared leaf (data model + event vocabulary) and imports nothing;
  the engine never depends on a surface; the browser frontend only imports
  `@agent-loop/contracts`. Enforced by `bun run check:boundaries`.
- **The engine is agent-agnostic.** `core/` drives the loop; behavior enters through an
  agent's middleware and tools, never by branching on agent identity in the engine.
- **Explicit dependencies, no new globals.** Runtime collaborators flow through
  `RuntimeContext` / `RuntimeDeps`; do not add module-level singletons or `getX()` lookups.
- **Strict typing at boundaries.** Treat provider output, tool args, and external JSON as
  untrusted; parse to typed structures before they reach the loop. Prefer `unknown` + narrowing.
- **Fail fast over silent fallback.** Reject unknown input (e.g. an unknown model id) loudly;
  do not paper over it with a default.
- **Style.** No semicolons, double quotes, 2-space indent, `import type` for type-only
  imports. JSDoc on exported API, `//` on internal implementation.

Full rationale and the rest of the engineering conventions live in
[`docs/conventions.md`](docs/conventions.md).

## Doc Map

`docs/modules/` is organized by package — find the package you're touching, read its doc,
then confirm details in code.

| When you are working on… | Read |
| --- | --- |
| Anything — overall structure & execution path | [`docs/project-map.md`](docs/project-map.md) |
| Engineering conventions & accumulated principles | [`docs/conventions.md`](docs/conventions.md) |
| **harness** — the loop, turn lifecycle, middleware, session state | [`docs/modules/harness/core-and-runtime.md`](docs/modules/harness/core-and-runtime.md) |
| **harness** — models, providers, streaming protocol | [`docs/modules/harness/llm-and-providers.md`](docs/modules/harness/llm-and-providers.md) |
| **harness** — agents, agent middleware, tools, delegation | [`docs/modules/harness/agents-and-tools.md`](docs/modules/harness/agents-and-tools.md) |
| **backend** — HTTP/SSE transport & composition | [`docs/modules/backend/http-and-sse.md`](docs/modules/backend/http-and-sse.md) |
| **backend** — board report domain & PostgreSQL | [`docs/modules/backend/board.md`](docs/modules/backend/board.md) |
| **contracts** — shared vocabulary: data model, events, reducer | [`docs/modules/contracts.md`](docs/modules/contracts.md) |
| **tui** / **cli** / **frontend** — a surface | [`docs/modules/tui.md`](docs/modules/tui.md) · [`cli.md`](docs/modules/cli.md) · [`frontend.md`](docs/modules/frontend.md) |

[`docs/README.md`](docs/README.md) explains how the docs are organized and how to write them.

## Doc Sync

When you change a module's responsibility, the runtime flow, or a user-visible command,
update the matching doc in the same change. Docs state durable design — not a changelog.

## Validation

```bash
bun run check             # per-package tsc
bun run check:boundaries  # dependency direction
bun run test:harness      # harness test suite
bun run build             # bundle the CLI
```

## Environment

- `DASHSCOPE_API_KEY` — required to reach the model.
- `DASHSCOPE_BASE_URL` — optional; defaults to the DashScope OpenAI-compatible endpoint.

## Reference

Upstream OpenCode, used as the behavioral reference:
`https://github.com/anomalyco/opencode/tree/dev/packages/opencode`.

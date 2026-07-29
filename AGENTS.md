# AGENTS.md

A compact TypeScript agent runtime (Bun workspaces) that captures OpenCode's core
behavior: an agentic loop with tool execution, subagent delegation, session state,
provider adaptation, and compaction — not a full product clone.

Two packages: `agent-core` is the general agent loop; `harness` is the coding agent
built on it. Surfaces (`cli`, `tui`) drive the harness.

This file is the entry point: the core constraints below are non-negotiable; the
**Doc Map** routes you to the right document before you read source.

## Core Constraints

- **Aliases, not relative paths.** Cross-package imports go through a package barrel
  (`@agent-core`, `@harness`); inside a package, use its own alias (`@harness/*`,
  `@agent-core/*`, `@tui/*`). All registered in `tsconfig.base.json`. Never reintroduce a
  shared `@/` alias; never add `.js` suffixes.
- **One-way dependencies.** `agent-core <- harness <- surfaces` (cli/tui).
  `agent-core/src/model.ts` is the pure leaf (data model + event vocabulary) and imports
  nothing; agent-core does not know orchestration exists; the engine never depends on a
  surface. Enforced by `bun run check:boundaries`.
- **agent-core is the general loop.** It drives one agent and knows nothing about skills,
  files, or multiple agents. Behavior enters through middleware and tools, never by
  branching on agent identity. To decide whether something belongs there, ask *"does a
  general agent loop need this?"* — not *"is it used today?"*.
  `packages/agent-core/tests/standalone.test.ts` is the acceptance test for that answer.
- **Explicit dependencies, no new globals.** Runtime collaborators flow through
  `RuntimeContext` / `EngineDeps`; a tool's own collaborators go in its factory closure,
  not on `ToolContext`. Do not add module-level singletons or `getX()` lookups.
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
| **agent-core** — data model, the loop, step lifecycle, hooks, session state | [`docs/modules/agent-core/loop-and-state.md`](docs/modules/agent-core/loop-and-state.md) |
| **agent-core** — models, providers, streaming protocol | [`docs/modules/agent-core/llm-and-providers.md`](docs/modules/agent-core/llm-and-providers.md) |
| **harness** — agents, prompt assembly, tools, skills, delegation, workspace | [`docs/modules/harness/agents-and-tools.md`](docs/modules/harness/agents-and-tools.md) |
| **harness** — runtime assembly, middleware catalogue, config layering | [`docs/modules/harness/runtime-and-middleware.md`](docs/modules/harness/runtime-and-middleware.md) |
| **tui** / **cli** — a surface | [`docs/modules/tui.md`](docs/modules/tui.md) · [`cli.md`](docs/modules/cli.md) |

[`docs/README.md`](docs/README.md) explains how the docs are organized and how to write them.

## Doc Sync

When you change a module's responsibility, the runtime flow, or a user-visible command,
update the matching doc in the same change. Docs state durable design — not a changelog.

## Validation

```bash
bun run check             # per-package tsc
bun run check:boundaries  # dependency direction
bun run test              # all three package suites
bun run build             # bundle the CLI
```

## Environment

- `DASHSCOPE_API_KEY` — required to reach the model.
- `DASHSCOPE_BASE_URL` — optional; defaults to the DashScope OpenAI-compatible endpoint.

## Reference

Upstream OpenCode, used as the behavioral reference:
`https://github.com/anomalyco/opencode/tree/dev/packages/opencode`.

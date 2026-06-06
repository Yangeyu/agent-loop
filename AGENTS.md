# AGENTS.md

Repository core constraints for coding agents.

## Purpose

- Build a compact TypeScript runtime that captures core OpenCode behavior, not a full product clone.
- Prioritize loop control, tool execution, subagent delegation, session flow, provider adaptation, and compaction.
- Use upstream OpenCode as the main reference: `https://github.com/anomalyco/opencode/tree/dev/packages/opencode`

## Local Map (monorepo)

Bun workspaces: `packages/*` + `apps/*`. Cross-package imports use per-package
aliases registered once in `tsconfig.base.json`: `@harness/*`, `@backend/*`,
`@tui/*`, `@contracts`. Each package keeps its own alias for internal imports.

- `packages/harness/`: the agent harness (engine). `src/{runtime,session,llm,tool,agent,skill,plugin}`, `config.ts`, `types.ts`, and `src/index.ts` public barrel. Depends on no other workspace package.
- `packages/backend/`: thin HTTP/SSE transport over the harness, plus the `board/` domain plugin and `integrations/postgres`. `src/compose.ts` is the composition root (corePlugin + boardPlugin); `src/server.ts` is the SSE entry.
- `packages/tui/`: terminal UI (opentui/solid).
- `packages/contracts/`: wire types shared by backend and frontend (SSE `StreamEvent`, attachments). Browser-safe, pure types — the single source of truth for the streaming protocol.
- `apps/cli/`: CLI entrypoint (`src/index.ts`).
- `apps/frontend/`: Vite + React web app; imports the wire contract as `@agent-loop/contracts`.

Dependency direction is one-way (surfaces → harness) and enforced by
`bun run check:boundaries`. The harness never imports a surface; the browser
frontend only imports `@agent-loop/contracts`.

## Upstream Map

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/store.ts`
- `packages/opencode/src/session/compact.ts`
- `packages/opencode/src/tool/task.ts`
- `packages/opencode/src/tool/tool.ts`
- `packages/opencode/src/provider/`

## Project Docs Map

- Read `docs/README.md` first when you need the project documentation index.
- Read `docs/project-map.md` first when you need the overall architecture and execution path.
- Before exploring source deeply, prefer the matching module doc under `docs/modules/` and then confirm details in code.
- Keep `docs/` in sync when module responsibilities, runtime flow, or user-visible capabilities change.

```text
docs/
├── README.md
├── project-map.md
└── modules/
    ├── entrypoints-and-ui.md
    ├── runtime-and-session.md
    ├── llm-and-providers.md
    ├── agents-and-tools.md
    └── board-and-integrations.md
```

### Doc Routing

- CLI or TUI work: read `docs/modules/entrypoints-and-ui.md`
- Runtime loop, store, compaction, or system prompt work: read `docs/modules/runtime-and-session.md`
- Model/provider/streaming work: read `docs/modules/llm-and-providers.md`
- Agent/tool/delegation work: read `docs/modules/agents-and-tools.md`
- Board report or PostgreSQL integration work: read `docs/modules/board-and-integrations.md`

## Core Constraints

- Keep the main runtime flow explicit: input -> model -> tool execution -> session update -> next step.
- Preserve upstream concepts and naming when they improve clarity.
- Choose design patterns by module responsibility; use the simplest design that stays clear and extensible.
- Follow SOLID pragmatically: keep single responsibilities clear, extend with composition over branching, preserve substitutability at module boundaries, keep interfaces narrow, and depend on abstractions at runtime seams.
- Keep providers, tools, stores, and renderers as focused boundary adapters.
- Centralize and make traceable all state transitions around session messages, parts, tools, and compaction.
- Introduce abstractions only when they clearly improve readability, reuse, or change isolation.

## Code Constraints

- Use per-package aliases for source modules: `@harness/*`, `@backend/*`, `@tui/*`, `@contracts` (registered in `tsconfig.base.json`). Do not reintroduce a shared `@/` alias — it cannot resolve across packages when source is consumed directly.
- Do not add `.js` suffixes to TypeScript imports.
- Prefer `import type` for type-only imports.
- Keep strict typing; prefer `unknown` plus narrowing over `any`.
- Follow existing style: no semicolons, double quotes, 2-space indentation.
- Prefer short functions and straightforward module boundaries.
- When applying SOLID here, prefer small focused modules, explicit dependency injection for runtime collaborators, and narrow interfaces over catch-all managers.

## Type And Tool Constraints

- Model core runtime data with explicit types and discriminated unions.
- Treat provider responses, tool args, SSE payloads, and external JSON as untrusted input.
- Parse unknown input into typed structures before it reaches the core loop.
- Keep each tool's metadata, schema, and execution logic close together.
- Register new tools in `packages/harness/src/runtime/bootstrap.ts` and enable them for the right agents.
- If a tool result must persist across turns, write it back into session history consistently.

## LLM Constraints

- Keep `packages/harness/src/llm/index.ts` as the lightweight entrypoint.
- Keep model selection in `packages/harness/src/llm/models.ts`.
- Keep shared provider flow in `packages/harness/src/llm/providers/create.ts`.
- Keep provider-specific logic inside `packages/harness/src/llm/providers/`.
- Preserve the internal stream contract from `packages/harness/src/llm/types.ts`.
- Map provider output into internal chunk types instead of leaking provider-specific structures upward.

## Session And CLI Constraints

- Main loop: `packages/harness/src/session/prompt.ts`.
- Per-turn executor: `packages/harness/src/session/processor.ts`.
- Persistence: `packages/harness/src/session/store/`.
- Keep output policy out of the core loop.
- Route runtime output through `packages/harness/src/runtime/logger.ts`.
- Keep `apps/cli/src/index.ts` focused on CLI parsing and orchestration.

## Validation

- Use bun scripts from `package.json`.
- Baseline checks: `bun run check` (per-package tsc), `bun run check:boundaries` (dependency direction), `bun run build`, and focused `bun run ...` smoke runs.
- Useful smoke runs:

```bash
bun run start --output stream "你是谁"
LLM_MODE=qwen bun run start --output stream "你是谁"
LLM_MODE=fake bun run start --output buffered "@general investigate auth flow"
```

- There is currently no `npm test` script.

## Environment

- `LLM_MODE=qwen|fake`
- `DASHSCOPE_API_KEY`
- `QWEN_API_KEY`
- `QWEN_BASE_URL`

## Repo Rules

- Check `.cursor/rules/`, `.cursorrules`, and `.github/copilot-instructions.md` if they appear.
- If new repo-level instruction files are added, follow them and update this document.
- Update `README.md` when changing user-visible behavior or commands.

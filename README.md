# Agent Loop

A compact TypeScript agent runtime built around an explicit agentic loop with tool
execution, subagent delegation, session state, provider adaptation, and compaction.
It is a from-scratch build of the core machinery an agent runtime needs — not a product
clone — with these moving parts:

- `runSession` / `runLoop` (`agent/loop.ts`) as the outer agentic loop
- `core/turn.ts` as the per-turn stream-and-tool executor
- `Model.stream()` (`llm/`) as the model-facing boundary — one bound model per agent, no registry
- the `task` tool as the subagent orchestration primitive
- the `compaction` middleware as the context compaction path
- `structured-output` middleware for JSON-schema-style final answers
- reasoning parts emitted as a first-class event stream
- a local split-pane CLI TUI for the interactive terminal experience

> Architecture and module docs live under [`docs/`](docs/README.md); start at
> [`AGENTS.md`](AGENTS.md). This README is the run guide.

## Files

Bun workspaces — `packages/*` (libraries) and `apps/*` (runnable surfaces). Cross-package imports use the aliases `@harness/*`, `@tui/*`, `@contracts`.

- `packages/harness/`: the agent harness (engine). Key areas:
  - `src/agent/`: the agent kernel — blueprint/createAgent, the 5-hook middleware contract (`hooks.ts`), the loop (`loop.ts`), per-turn executor (`turn.ts`), policy, retry
  - `src/std/`: standard bricks — middleware (compaction, structured-output, view-image, budgets), the lead/general agents, core tools
  - `src/llm/`: the `Model` abstraction and providers (`providers/openai-compat.ts` base, `providers/dashscope.ts`)
  - `src/agent/`: agents as self-contained modules (`lead/`, `general/`)
  - `src/tool/`: `defineTool` harness and built-in tools (`task`, `bash`, `read`, …)
  - `tests/`: centralized harness test suite, organized by source module area
  - `e2e/`: end-to-end cases against the real model, skipped without an API key
- `packages/tui/`: `src/app.tsx` componentized OpenTUI/Solid terminal UI
- `packages/contracts/`: the pure shared leaf — data model + event vocabulary the harness and surfaces speak
- `apps/cli/`: `src/index.ts` CLI bootstrap and mode selection, `src/compose.ts` the composition root (the one place providers are bound), `src/logger.ts` CLI UI renderer (`stream` / `buffered`)
- `skills/`: workspace skills, one directory per skill (`SKILL.md` + assets); discovered at startup
- `bunfig.toml`: bun preload for OpenTUI Solid JSX transforms

## Import Conventions

- Use per-package absolute aliases for project source modules: `@harness/*`, `@tui/*`, `@contracts` (registered in `tsconfig.base.json`). Example: `@harness/agent/loop`.
- Do not use relative imports for project-internal modules unless there is a strong reason.
- Do not add `.js` suffixes to TypeScript source imports.
- `bun run build` bundles the CLI with `Bun.build` (alias resolution via tsconfig paths), emitting runnable ESM to `dist/`.

## Run

```bash
bun install
bun run start "read packages/harness/src/agent/loop.ts and explain the loop"
```

The project is bun-first for local development:

- `bun run start` runs the TypeScript CLI entrypoint directly
- `bun run tui` opens the interactive TUI directly
- `bun run build` bundles the CLI with Bun.build into `dist/`
- `bun run test:harness` runs the centralized `packages/harness/tests` suite
- `bun run test:harness:e2e` runs the `packages/harness/e2e` cases against the real model (needs `DASHSCOPE_API_KEY`; skipped without one)
- `bun run test:tui` runs the focused `packages/tui/tests` suite

Useful flags:

- `--agent <name>` to pick a primary agent (defaults to `lead`)
- `--session <id>` to continue an existing session from the CLI
- `--json` to print the full final session JSON after the live CLI UI
- `--output stream|buffered`
- `--tui` to force the interactive terminal UI

Examples:

```bash
bun run start --output buffered "Run nested batch smoke for tool harness"
```

In an interactive terminal, running without a prompt now opens the TUI by default:

```bash
bun run start
```

For a direct shortcut, you can also use:

```bash
bun run tui
```

You can also open the TUI and immediately submit a prompt:

```bash
bun run tui "read packages/harness/src/agent/loop.ts and explain the loop"
```

Built-in tools: `read`, `write`, `grep`, `bash`, `tavily`, `present_files`, `view_image`, `task` / `task_resume`, and `skill`.

The runtime supports skills discovered from `skills/`: the system prompt exposes the available skill list, and the model calls the `skill` tool to load a specialized workflow on demand instead of carrying every long instruction in the base prompt. Loading a skill also prints the absolute paths of its sibling assets, so the model can `read` them directly.

Example with the simple CLI display:

```bash
bun run start "Use the available tools when helpful. Read packages/harness/src/agent/loop.ts and explain runLoop."
```

Streaming mode prints the answer as it arrives and keeps tool activity readable:

```bash
bun run start --output stream "Use the available tools when helpful. Read packages/harness/src/agent/loop.ts and explain runLoop."
```

Buffered mode waits until the turn completes, then prints compact thinking/answer blocks:

```bash
bun run start --output buffered "Use the available tools when helpful. Read packages/harness/src/agent/loop.ts and explain runLoop."
```

The split-pane TUI now uses `@opentui/solid` components, keeps the current session transcript on the right and session/status navigation on the left, and renders user/assistant/thinking/tool content in separate cards. It supports:

- `Enter` to submit the current prompt
- `@` in the composer to open a filtered workspace file list; selecting an image path still turns it into an image attachment on submit
- `Ctrl+V` in the composer to attach the current macOS clipboard image as an inline screenshot
- `Tab` to cycle primary agents
- `Ctrl+N` to start a new local session
- `Ctrl+J` / `Ctrl+K` to switch sessions
- `Esc` to cancel the current turn or clear the draft
- `Ctrl+C` to cancel the current turn, then exit when idle

The simple renderer still shows terminal output for:

- a small startup banner for the CLI
- session metadata and loop step headings
- streamed or buffered thinking/final answer sections
- formatted tool activity lines for `read`, `grep`, `glob`, `bash`, `task`, and fallback tools
- compaction, structured output, and final turn status lines

## Qwen (DashScope)

Agents bind a DashScope (qwen) model by default, targeting `qwen3.7-plus` over the
DashScope OpenAI-compatible endpoint. Set your key and run:

```bash
export DASHSCOPE_API_KEY=...
bun run start
```

Optional overrides:

- `DASHSCOPE_BASE_URL` defaults to `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `MODEL_MAX_RETRIES`, `MODEL_RETRY_BASE_DELAY_MS`, `MODEL_RETRY_MAX_DELAY_MS` tune model retry behavior
- `SESSION_MAX_STEPS` caps total assistant turns across a session (kept well above any one agent's step cap)
- `SKILLS_DIR` points at the workspace skills directory (default `./skills`; absent means no workspace skills)
- `SUBAGENT_MAX_DEPTH` caps child-session delegation depth
- `TURN_TIMEOUT_MS`, `REPEATED_TOOL_FAILURE_THRESHOLD` tune per-turn execution limits
- `RUN_MAX_TOOL_CALLS` caps tool calls across a whole agent run (an agent may override it); `TOOL_MAX_CONCURRENCY` caps parallel calls within one turn

Useful smoke checks:

```bash
bun run test:harness
bun run test:tui
bun run check
bun run build
bun run smoke:text
bun run smoke:harness
bun run smoke:tui
```

## Notes

- The DashScope (qwen) provider streams over the OpenAI-compatible endpoint and maps `reasoning_content` into internal reasoning events via the provider's `readReasoning` hook.
- The renderer stays compact and event-driven, built around this repo's own runtime events.
- The renderer is intentionally mode-based: `stream` prints model output deltas in real time, while `buffered` prints complete reasoning/final blocks after each turn.
- The `task` tool creates a child session and recursively re-enters `runSession`, which is the core subagent orchestration pattern.
- Tests exercise subagents, invalid tool args, nested batched tools, structured output capture, and compaction against a stubbed `Model` (`tests/support/fake-model.ts`), with no network calls.

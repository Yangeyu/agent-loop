# Minimal OpenCode-Like Agent Runtime

This project extracts a compact core of the `opencode` runtime shape, focused on:

- `SessionPrompt.loop()` as the outer agentic loop
- `SessionProcessor.process()` as the per-step stream and tool executor
- `LLM.stream()` as the model-facing boundary
- `TaskTool.execute()` as the subagent orchestration primitive
- `SessionCompaction.process()` as the context compaction path
- injected `StructuredOutput` handling for JSON-schema-style final answers
- reasoning parts emitted as a first-class event stream
- a local split-pane CLI TUI inspired by OpenCode's terminal experience

## Files

Bun workspaces — `packages/*` (libraries) and `apps/*` (runnable surfaces). Cross-package imports use the aliases `@harness/*`, `@backend/*`, `@tui/*`, `@contracts`.

- `packages/harness/`: the agent harness (engine). Key files:
  - `src/session/prompt.ts`: outer session loop
  - `src/session/processor.ts`: one-step processor
  - `src/session/compaction.ts`: compact old context into a summary message
  - `src/llm/index.ts`: LLM selector; `src/llm/providers/{qwen,fake}.ts`: provider impls; `src/llm/types.ts`: stream types
  - `src/runtime/logger.ts`: CLI UI renderer with `stream` and `buffered` modes
  - `src/tool/{task,batch,bash}.ts`: subagent execution, parallel fan-out, shell tool
  - `tests/`: centralized harness test suite, organized by source module area
- `packages/backend/`: thin HTTP/SSE transport over the harness. `src/server.ts` SSE entry, `src/http/` routes+OpenAPI, `src/compose.ts` composition root, `src/board/` report domain plugin, `src/integrations/postgres/`
- `packages/tui/`: `src/app.tsx` componentized OpenTUI/Solid terminal UI
- `packages/contracts/`: wire types shared by backend and frontend (SSE `StreamEvent` etc.)
- `apps/cli/`: `src/index.ts` CLI bootstrap and mode selection
- `apps/frontend/`: minimal React chat client for the SSE API (imports `@agent-loop/contracts`)
- `bunfig.toml`: bun preload for OpenTUI Solid JSX transforms

## Import Conventions

- Use per-package absolute aliases for project source modules: `@harness/*`, `@backend/*`, `@tui/*`, `@contracts` (registered in `tsconfig.base.json`). Example: `@harness/session/prompt`.
- The frontend (browser) imports the wire contract by package name: `@agent-loop/contracts`.
- Do not use relative imports for project-internal modules unless there is a strong reason.
- Do not add `.js` suffixes to TypeScript source imports.
- `bun run build` bundles the CLI with `Bun.build` (alias resolution via tsconfig paths), emitting runnable ESM to `dist/`.

## Run

```bash
bun install
bun run start "read src/session/prompt.ts and explain the loop"
```

The project is now bun-first for local development:

- `bun run dev` starts the SSE backend in `bun --watch` mode and starts the `apps/frontend/` React dev server with the same resolved API base URL
- `bun run start` runs the TypeScript CLI entrypoint directly
- `bun run sse` starts a minimal SSE HTTP server on port `4444`
- `bun run tui` opens the interactive TUI directly
- `bun run build` bundles the CLI with Bun.build into `dist/`
- `bun run test:harness` runs the centralized `packages/harness/tests` suite
- `bun run test:tui` runs the focused `packages/tui/tests` suite

The repo also includes a standalone minimal React frontend under `apps/frontend/`:

```bash
bun run dev
```

This gives you:

- frontend HMR through Vite
- backend auto-restart on `packages/backend/src/` changes through `bun --watch`
- backend logs printed in the same terminal

Or run them separately:

```bash
bun run sse
cd apps/frontend
bun install
bun run dev
```

Then open:

```bash
http://localhost:5173
```

Override the backend base URL with `VITE_API_BASE_URL` when needed.

The frontend transcript now renders one assistant message per submitted user prompt, then orders the inner content as alternating `CoT` and `build answer` blocks based on streamed turn output. Tool activity and delegated subagent steps stay inside that single assistant message instead of splitting into separate bubbles.

SSE server example:

```bash
bun run sse
curl -N -X POST http://localhost:4444/api/chat \
  -H 'content-type: application/json' \
  -d '{"text":"read packages/harness/src/session/prompt.ts and explain the loop"}'
```

If port `4444` is occupied, the server now automatically tries the next ports. You can also pin a port explicitly:

```bash
bun run sse --port 3100
PORT=3100 bun run sse
```

The SSE endpoint emits frontend-friendly events modeled after the Vercel SDK stream shape:

- `session-metadata`
- `message-metadata`
- `text-start`
- `text-delta`
- `reasoning-delta`
- `tool-call`
- `tool-result`
- `finish`
- `error`
- `done`

For streamed assistant output, `messageID` now identifies the whole reply to one user prompt, while `turnID` identifies an individual assistant step inside that reply.

Online API docs are also available:

```bash
http://localhost:4444/openapi.json
http://localhost:4444/docs
```

`/docs` uses Scalar to render the live OpenAPI document exposed by `/openapi.json`.

Useful flags:

- `--agent build`
- `--session <id>` to continue an existing session from the CLI
- `--json` to print the full final session JSON after the live CLI UI
- `--trace` to print the current run's turn trace after the answer
- `--replay-step <n>` to print a replayable turn-input snapshot for a traced step
- `--replay-turn <id>` to print a replayable turn-input snapshot for a traced assistant turn
- `--output stream|buffered`
- `--tui` to force the interactive terminal UI

Trace/replay debug output is process-local: it works for turns executed by the current CLI invocation, including continued runs with `--session`, but it does not reconstruct prior trace history from stored session files alone.

Examples:

```bash
bun run start --output buffered --trace "Run nested batch smoke for tool harness"
bun run start --output buffered --trace --replay-step 1 "Run nested batch smoke for tool harness"
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
bun run tui "read packages/harness/src/session/prompt.ts and explain the loop"
```

Available built-in tools now include `read`, `grep`, `bash`, `batch`, `task`, and `skill`.

The runtime now also supports app-registered skills: the system prompt exposes the available skill list, and the model can call the `skill` tool to load a specialized workflow on demand instead of carrying every long instruction in the base prompt.

There is also a minimal board report flow backed by PostgreSQL:

```bash
bun run start --agent board_report --output buffered "Analyze board <board-id> and return a structured report."
```

The default `build` agent routes board-report requests to the `board_report` specialist, which calls `board_snapshot`, reads from the Kiwoo business database, and emits a structured multi-chapter JSON report.

For the board analysis workflow, the final `board_write` stage now saves the generated Markdown report under the current project's data directory and returns only the saved file path, instead of streaming the full report body back through the main chat transcript.

Example with the simple CLI display:

```bash
bun run start "Use the available tools when helpful. Read packages/harness/src/session/prompt.ts and explain SessionPrompt.loop."
```

Streaming mode prints the answer as it arrives and keeps tool activity readable:

```bash
bun run start --output stream "Use the available tools when helpful. Read packages/harness/src/session/prompt.ts and explain SessionPrompt.loop."
```

Buffered mode waits until the turn completes, then prints compact thinking/answer blocks:

```bash
bun run start --output buffered "Use the available tools when helpful. Read packages/harness/src/session/prompt.ts and explain SessionPrompt.loop."
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

- a small startup banner inspired by OpenCode's CLI style
- session metadata and loop step headings
- streamed or buffered thinking/final answer sections
- formatted tool activity lines for `read`, `grep`, `glob`, `bash`, `task`, and fallback tools
- compaction, structured output, and final turn status lines

## Qwen

By default the runtime will use Qwen when one of these environment variables is present:

- `DASHSCOPE_API_KEY`
- `QWEN_API_KEY`

It targets `qwen3.5-plus` and the DashScope compatible endpoint by default:

```bash
export DASHSCOPE_API_KEY=...
bun run start
```

Optional overrides:

- `QWEN_BASE_URL` defaults to `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `LLM_MODE=fake` forces deterministic local behavior
- `LLM_MODE=qwen` forces remote Qwen mode
- `MODEL_MAX_RETRIES`, `MODEL_RETRY_BASE_DELAY_MS`, `MODEL_RETRY_MAX_DELAY_MS` tune model retry behavior
- `SESSION_MAX_STEPS` caps total assistant turns across a session
- `SUBAGENT_MAX_DEPTH` caps child-session delegation depth
- `TURN_TIMEOUT_MS`, `TURN_MAX_TOOL_CALLS`, `REPEATED_TOOL_FAILURE_THRESHOLD` tune per-turn execution limits

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

- The Qwen implementation now uses DashScope SSE directly so `reasoning_content` can be mapped into internal reasoning events reliably.
- The renderer borrows from OpenCode's CLI presentation approach, but stays compact and event-driven around this repo's own runtime events.
- The renderer is intentionally mode-based: `stream` prints model output deltas in real time, while `buffered` prints complete reasoning/final blocks after each turn.
- `TaskTool` creates a child session and recursively re-enters `SessionPrompt.prompt()`, which mirrors the core orchestration pattern in `opencode`.
- In fake mode the demo still exercises subagents, invalid tool args, nested batched tools, structured output capture, and compaction.

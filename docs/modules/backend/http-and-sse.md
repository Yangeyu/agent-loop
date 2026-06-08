# HTTP 与 SSE

> 范围：`packages/backend` 的传输层——`server.ts`、`http/`、`compose.ts`。board 领域见 `board.md`。

## 职责

把 harness 包成一个薄 HTTP/SSE 服务：接收聊天请求，把 runtime 事件流式推给前端。只做传输与
事件映射，不持有 session 状态（状态归 harness 的 `session_store`）。

## 关键入口

- `@backend/src/server.ts` — 启动入口，拉起 `http/` 的 HTTP 服务。
- `@backend/src/http/server.ts` — `Bun.serve()` 路由装配。
- `@backend/src/http/chat.ts` — `POST /api/chat` SSE 接口。
- `@backend/src/http/openapi.ts` — `/openapi.json` 与 `/docs`。
- `@backend/src/compose.ts` — 应用层组合根：装配 `corePlugin + boardModule` 成一个 runtime。

## 数据流

- `compose.ts` 装配 runtime（core + board 插件）。
- `POST /api/chat` 接收 `text` + 可选 `agent` / `sessionID`，发起一次 session。
- 为每个请求订阅 `runtime.events`，把内部事件映射成 `@agent-loop/contracts` 的 `StreamEvent` 帧
  推给前端（协议定义见 `../contracts.md`）。
- 每帧带 `messageID`（整次回复）+ `turnID`（回复内的 step）；子 agent 事件透传到同一条流，
  保留 runtime 的 session tree 语义。
- 端口被占用时自动顺延；可用 `--port` 或 `PORT` 固定。

## 扩展点

- 新 HTTP 路由：加到 `http/`，并在 `http/server.ts` 注册。
- 新装配组合：在 `compose.ts` 增减插件，不改 harness。

## 约束与经验

- backend 是**薄传输层**：只映射事件、不复制 session 状态、不写业务逻辑（业务走插件，如 board）。
- 对外事件形状以 `@agent-loop/contracts` 为唯一真相；新增事件先改 contracts，再同步 backend 与 frontend。

# HTTP 与 SSE

> 范围：`packages/backend` 的传输层——`server.ts`、`http/`、`compose.ts`。board 领域见 `board.md`。

## 职责

把 harness 包成一个薄 HTTP/SSE 服务：接收聊天请求，把 runtime 事件流式推给前端。只做传输，
不持有 session 状态（状态归 harness 的 `Sessions` 聚合）。

## 关键入口

- `@backend/src/server.ts` — 启动入口，拉起 `http/` 的 HTTP 服务。
- `@backend/src/http/server.ts` — `Bun.serve()` 路由装配。
- `@backend/src/http/chat.ts` — `POST /api/chat` SSE 接口。
- `@backend/src/http/openapi.ts` — `/openapi.json` 与 `/docs`。
- `@backend/src/compose.ts` — 应用层组合根，也是**唯一的 provider 绑定点**：在此构建模型实例、
  调用 core/board 的 agent/tool 工厂、以扁平列表 `createRuntime({ agents, tools, skills })`。

## 数据流

- `compose.ts` 装配 runtime（core + board 的展开式组合，组合即代码）。
- `POST /api/chat` 接收 `text` + 可选 `agent` / `sessionID`，发起一次 session。
- 为每个请求订阅 `runtime.events` 的 state 与 loop 两个通道，按 `event.rootID === 请求会话.rootID`
  做 O(1) 过滤后**原样透传**为 `state` / `loop` SSE 帧（协议即 `@agent-loop/contracts` 的事件词汇，
  见 `../contracts.md`）；没有翻译层。
- 子 agent 事件天然在同一棵 rootID 树下，透传到同一条流。
- 端口被占用时自动顺延；可用 `--port` 或 `PORT` 固定。

## 扩展点

- 新 HTTP 路由：加到 `http/`，并在 `http/server.ts` 注册。
- 新装配组合：在 `compose.ts` 的展开列表里增减 agents/tools/skills，不改 harness。

## 约束与经验

- backend 是**薄传输层**：只过滤+透传、不复制 session 状态、不写业务逻辑（业务走插件，如 board）。
- 对外事件形状以 `@agent-loop/contracts` 为唯一真相；新增事件改 contracts + harness 发射端即可，
  backend 不需要随之改动。

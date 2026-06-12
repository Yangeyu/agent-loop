# Frontend

> 范围：`apps/frontend`——Vite + React Web 聊天客户端。

## 职责

一个独立最小的浏览器聊天页面，消费 backend 的 SSE 接口并把一次回复渲染成可读的对话。

## 关键入口

- `apps/frontend/` — React 应用。
- `@agent-loop/contracts` — 按包名引用的 wire 协议（浏览器侧不走源码别名）。

## 数据流

- 浏览器 `fetch` + SSE 解析消费 `POST /api/chat`，逐帧消费 `StreamEvent`（`state` / `loop` /
  `done` / `error`，协议见 `contracts.md`）。
- 内容全部来自 `state` 帧（与 harness 存储同一词汇）：`message.created` 开 turn、`part.delta`
  累积 reasoning/text、tool part 快照驱动工具卡片；`loop` 帧只用于 sessionID 等元信息。
- 每次用户提交只渲染**一条** assistant 消息，把该请求内多个 turn（= assistant message）折叠进去。
- 消息内部按输出顺序交错两类区块：`CoT` 承载 reasoning / tool / subagent 轨迹，`build answer` 承载正文；
  `CoT` 按 session 聚合，delegated task 优先用 `task.description` 作标题。
- turn 的标识就是 assistant message 的 id（没有独立 turnID 概念）。
- 默认开发地址 `http://localhost:5173`，后端默认 `http://localhost:4444`，可用 `VITE_API_BASE_URL` 覆盖。

## 扩展点

- 改渲染/折叠逻辑：在 frontend 组件层。
- 消费新事件：先在 `contracts` 加事件，再在前端处理。

## 约束与经验

- 前端只 import `@agent-loop/contracts`，**不依赖 harness 源码**（浏览器边界，由 `check:boundaries` 保证）。
- 事件形状以 contracts 为准，不在前端臆造字段。

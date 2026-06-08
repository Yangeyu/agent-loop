# Contracts（wire 协议）

> 范围：`packages/contracts`——backend 与 frontend 之间唯一的共享类型来源。浏览器安全、纯类型。

## 职责

定义流式聊天协议的 wire 类型：SSE 事件形状与工具调用/产物结构。它是 backend↔frontend 的**接缝**，
两端都依赖它，谁都不直接 import 对方。

## 关键入口

- `@contracts`（`packages/contracts/src/index.ts`）— 导出全部 wire 类型。
- 前端按包名 `@agent-loop/contracts` 引用（浏览器侧不走源码别名）。

## 数据流

- `StreamEvent` 是一个判别联合（按 `event` 字段），覆盖一次回复的完整生命周期：
  `session-metadata`、`message-metadata`、`reasoning-delta`、`text-start`、`text-delta`、
  `tool-call`、`tool-result`、`finish`、`error`、`done`。
- 标识语义：`messageID` 标识整次用户回复，`turnID` 标识回复内的某个 assistant step，`sessionID`
  贯穿全程；子 agent 的事件携带其 child `sessionID`，透传到同一条流。
- 工具相关负载用 `ToolCallWire` / `ToolResultWire`，产物用 `ToolAttachment` / `ArtifactFile`——
  让前端不必感知 harness 内部的 `ToolPart` 结构。

## 扩展点

- 新事件：在 `StreamEvent` 联合里加一支，再同步 backend（产出）与 frontend（消费）。

## 约束与经验

- **纯类型、浏览器安全**：不放运行时代码、不依赖 Node/Bun API——它要能被前端打包。
- 这是流式协议的**唯一真相**：harness 内部结构（`ToolPart`、provider chunk）不直接外泄，先映射成 wire 类型。

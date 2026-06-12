# Contracts（共享词汇）

> 范围：`packages/contracts`——整条链路唯一的共享词汇来源。浏览器安全、纯类型 + 纯函数。

## 职责

一次性定义三样东西，让 harness、backend、frontend 不再各持一份表示：

1. **会话数据模型**：`SessionInfo`（含 `rootID`）、`SessionMessage`、`MessagePart`（text /
   reasoning / compaction / image / tool）。消息不携带 sessionID 回指；assistant message 即
   turn 的记录。
2. **两类事件**：`StateEvent`（会话状态变更，由 harness 的 `Sessions` 聚合在写入时发出）与
   `LoopEvent`（循环遥测）。事件信封自带 `sessionID/rootID`。
3. **共享投影**：`applyStateEvent`（纯 reducer）+ `partsOf` / `messageText`。折叠一个会话的
   完整状态事件流可精确复原 store 中的会话——这是协议的核心不变量。

## 关键入口

- `@contracts`（`packages/contracts/src/index.ts`）— 导出全部类型与 reducer。
- harness 经源码别名 `@contracts` 引用；前端按包名 `@agent-loop/contracts` 引用。
- 依赖方向：contracts ← harness ← surfaces（contracts 是叶子，谁都不被它依赖回去）。

## 数据流

- SSE wire 帧即事件本身：`StreamEvent = { event: "state" | "loop", data } | done | error`。
  backend 不做翻译，frontend 用同一个 reducer 折叠 `state` 帧。
- 粒度约定：高频的 text/reasoning 用 `part.delta`（带 `partType`，消费端无需自己记 part 类型）；
  其余一律整对象快照（`message.*` 带整条消息、`part.updated` 带整个 part），丢帧可被下一帧覆盖。
- compaction 走 `history.replaced`，携带完整新状态，增量投影在此重播种。

## 扩展点

- 新状态事实：在 `StateEvent` 加一支 + 在 `applyStateEvent` 加对应折叠 + 让 `Sessions` 的
  mutator 发出。三处同改，缺一不可。
- 新循环遥测：在 `LoopEvent` 加一支，引擎/middleware 发出。

## 约束与经验

- **纯类型 + 纯函数、浏览器安全**：不放运行时状态、不依赖 Node/Bun API——它要能被前端打包。
- 数据模型字段全部 `readonly`：写入只能发生在 harness 的 `Sessions` 聚合里（copy-on-write）。
- 这是整条链路的**唯一真相**：不要在 backend/frontend 重新声明消息或事件的形状。

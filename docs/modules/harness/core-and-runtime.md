# Core 与 Runtime

> 范围：harness 引擎主干——`core/`、`hooks/`、`middleware/`、`runtime/`、`session/`。

## 职责

项目的主循环核心：组装运行时、驱动多步推理、按生命周期调度 middleware、把消息与 parts
写回 session，并在上下文过长时压缩。引擎本身 **agent-agnostic**——行为由 middleware 与
工具注入，而不是在引擎里按 agent 分支。

## 关键入口

- `@harness/runtime/context.ts` — 组装 `RuntimeContext`（config、session_store、registries、events）；运行时依赖的唯一组合根。
- `@harness/runtime/bootstrap.ts` — 按插件注册 agents / tools / skills，产出装配好的 runtime。
- `@harness/core/loop.ts` — `runSession`（追加 user message）→ `runLoop`（逐 turn 驱动）。顶部注释是生命周期的权威定义。
- `@harness/core/turn.ts` — 跑单轮：带 retry 地 `ctx.model.stream()`，消费 chunk，派发工具，写回。
- `@harness/hooks/types.ts` — `Middleware` 契约与 `HookContext`。
- `@harness/core/policy.ts` — 把 config 与 agent 约束解析成 turn 级执行策略（retry / timeout / budgets）。
- `@harness/session/store/` — `ISessionStore` 接口、memory/file 实现、factory。
- `@harness/session/tool-part.ts` — 把运行中的工具调用归一化成稳定的 `ToolPart` 协议。

## 数据流

一次 `runSession` 追加 user message 后进入 `runLoop`，每一步是一个 turn，按固定生命周期推进：

```text
beforeTurn ──(gate 拦截)──► 结束并返回
contributeSystem → transformMessages      # ctx.system 在此填充（beforeTurn 时还是空）
runTurn:
  stream ─► 工具派发(beforeToolCall → execute → afterToolCall / onToolError) ─► onTurnFinish
resolveOutcome ──(break)──► 返回 ; 否则下一步
```

- **stream 消费**：`core/turn.ts` 把 reasoning/text 增量写入 parts，把 tool-call chunk 校验后执行，
  finish/error/abort 收口。retry 在此层包住 `model.stream`，是 turn 级关注点（Model 抽象保持薄）。
- **工具结果**：经 `tool-part.ts` 归一化成稳定 `ToolPart`（`state.status/input/title/metadata/output/error/time`）
  再落进 session，供 replay、compaction、board 等消费者依赖一个稳定边界。
- **outcome**：middleware 的 `resolveOutcome` 决定 `continue | break`；budget、doom-loop、repeated-failure
  在这里收口。
- **状态事实来源**：`session_store` 维护 `messages` 与 `parts`，是项目里最核心的状态来源。

## 扩展点

- 新 middleware：实现 `Middleware` 的相关 hook，加入 agent 的 middleware 组合（见 agents-and-tools）。
- 新执行预算/策略：扩展 `core/policy.ts`，从 config 解析，而不是在 turn 里写死。
- 新 store 后端：实现 `ISessionStore`，接入 `store/factory.ts`。
- 新可观测事件：扩展 `RuntimeEvent`，再同步 logger 与 TUI（事件总线是只读观测层，与 middleware 分离）。

## 约束与经验

- **引擎 agent-agnostic**：core 不认识具体 agent；新行为靠 middleware/工具组合，不靠分支。
- **依赖显式传递**：执行链通过 `RuntimeDeps` 拿依赖；能拿切片就不要持有整个 `RuntimeContext`，
  也不要回退到 `getRuntimeContext()` 式隐式访问。
- **不在 store 内维护启动型单例**，不在 `config.ts` 里写 `initXxx()`。
- compaction 是 session 维护手段而非长期存档：超过 `contextWindow × compaction_trigger_ratio` 时，
  在 `beforeTurn` 把较早一半压成一条 summary，保留最近一半（详见该 middleware 与 conventions 的“模块自包含”）。

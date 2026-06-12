# Core 与 Runtime

> 范围：harness 引擎主干——`core/`、`hooks/`、`middleware/`、`runtime/`、`session/`。

## 职责

项目的主循环核心：组装运行时、驱动多步推理、按生命周期调度 middleware、把消息与 parts
写进 session 聚合，并在上下文过长时压缩。引擎本身 **agent-agnostic**——行为由 middleware 与
工具注入，而不是在引擎里按 agent 分支。

## 状态与事件的单一真值链

这一层的轴心设计：**状态只有一个出口，事件是写入的副作用**。

- `Sessions`（`@harness/session/sessions.ts`）是会话状态的**唯一写入者**。每个 mutator 在同一个
  方法体内完成「构造新不可变快照 → persist → 发 StateEvent」，因此状态事件流在构造上完备：
  无法改状态而不发事件，也无法不改状态而发状态事件。
  不变量测试：`tests/session/state-events.test.ts`（折叠状态事件流 ≡ store 快照）。
- 事件总线（`@harness/runtime/events.ts`）分两个通道：
  - **state**：`StateEvent`（`message.created/updated`、`part.created/delta/updated`、
    `history.replaced`、`session.created`），只由 `Sessions` 发出；消费端用 `@contracts` 的
    `applyStateEvent` 投影回会话状态。
  - **loop**：`LoopEvent`（`session.start`、`turn.start/input/phase/retry/outcome/end`、
    `budget.hit`），引擎与 middleware 发出，纯遥测，store 中无对应物。
  - listener 异常按订阅者隔离，订阅方永远炸不掉引擎 turn。
- 词汇定义一次：数据模型与两类事件都在 `@contracts`（依赖方向 contracts ← harness ← surfaces）。
  事件信封自带 `sessionID/rootID`，会话树归属判定是 O(1) 比较。

## 身份模型

没有独立的 "turn" 实体：**一个 turn 产出恰好一条 assistant message**，事件与 hook 里的
`messageID` 永远指被变更/被产出的那条消息。消息不携带 sessionID 回指（归属由包含关系表达）；
`SessionInfo.rootID` 在创建时定根，子会话继承。

## 关键入口

- `@harness/runtime/context.ts` — 组装 `RuntimeContext`（config、sessions、registries、events）；运行时依赖的唯一组合根，`Sessions` 在此与 state 通道接线。
- `@harness/runtime/bootstrap.ts` — 按插件注册 agents / tools / skills，产出装配好的 runtime。
- `@harness/core/loop.ts` — `runSession`（追加 user message）→ `runLoop`（逐 turn 驱动）。顶部注释是生命周期的权威定义。
- `@harness/core/recorder.ts` — `TurnRecorder`：一个 turn 生命周期的唯一 owner。构造时追加
  assistant message 并发 `turn.start`；持有相位机、流式 part 游标、计数器；`finish/fail/abort`
  恰好终结一次（后到的终态被忽略，abort 与 finish 竞态不会双报）。turn 作用域的累积状态只活在这里——
  `TurnContext` 是不可变输入包，middleware 改不了它。
- `@harness/core/turn.ts` — 跑单轮：带 retry 地 `ctx.model.stream()`，消费 chunk 写入 recorder，派发工具。
- `@harness/hooks/types.ts` — `Middleware` 契约与 `HookContext`（只读；状态经 hook 返回值回流引擎）。
- `@harness/core/policy.ts` — 把 config 与 agent 约束解析成 turn 级执行策略（retry / timeout / budgets）。
- `@harness/session/` — `Sessions` 聚合 + `SessionPersistence`（read/persist/list 三方法契约，
  memory/file 实现）。file 后端：内存为真值、合并刷盘（debounce + 进程退出钩子）、tmp+rename 原子写、
  损坏文件即抛；factory 对未知类型即抛。
- `@harness/core/tool-part.ts` — 工具调用生命周期：纯状态转换（reducer）+ `ToolPartTracker`，
  后者经 `Sessions.replacePart` 写穿——每次转换同时就是 `part.updated` 事件，无手工镜像。

## 数据流

一次 `runSession` 追加 user message 后进入 `runLoop`，每一步是一个 turn，按固定生命周期推进：

```text
TurnRecorder 构造（追加 assistant message，发 turn.start）
beforeTurn ──(gate 拦截)──► recorder.finish + turn.outcome，返回
contributeSystem → transformMessages      # 装配产物以参数传入 runTurn，不挂在 ctx 上
runTurn:
  stream ─► 工具派发(beforeToolCall → execute → afterToolCall / onToolError) ─► onTurnFinish
         ─► recorder 终态（恰好一次）
resolveOutcome ──(break)──► 返回 ; 否则下一步
```

- **stream 消费**：`core/turn.ts` 把 reasoning/text 增量交给 recorder（落 part + 自动发
  `part.delta`），把 tool-call chunk 派发给 `core/tool-call.ts`，finish/error/abort 由 recorder 收口。
  retry 在此层包住 `model.stream`，是 turn 级关注点（Model 抽象保持薄）。
- **工具结果**：`core/tool-call.ts` 不发任何事件——一次调用的全部可观测事实就是 tool part 的状态
  转换（`part.created` 开场，`part.updated` 推进到 running/completed/error），由 tracker 写穿产生。
- **outcome**：middleware 的 `resolveOutcome` 决定 `continue | break`；budget、doom-loop、repeated-failure
  在这里收口。
- **状态事实来源**：`Sessions` 维护 `messages` 与 `parts`，是项目里最核心的状态来源；
  读取得到的是不可变快照（copy-on-write），持有者无法绕过聚合改状态。

## 扩展点

- 新 middleware：实现 `Middleware` 的相关 hook，加入 agent 的 middleware 组合（见 agents-and-tools）。
- 新执行预算/策略：扩展 `core/policy.ts`，从 config 解析，而不是在 turn 里写死。
- 新持久化后端：实现 `SessionPersistence`（三个方法），接入 `session/persistence.ts` 的 factory。
- 新可观测事实：状态类的加进 `@contracts` 的 `StateEvent` 并让 `Sessions` 的对应 mutator 发出；
  循环遥测类的加进 `LoopEvent`。永远不要在引擎里手工补发状态镜像事件。

## 约束与经验

- **引擎 agent-agnostic**：core 不认识具体 agent；新行为靠 middleware/工具组合，不靠分支。
- **依赖显式传递**：执行链通过 `RuntimeDeps` 拿依赖；能拿切片就不要持有整个 `RuntimeContext`，
  也不要回退到 `getRuntimeContext()` 式隐式访问。
- **不在聚合内维护启动型单例**，不在 `config.ts` 里写 `initXxx()`。
- compaction 是 session 维护手段而非长期存档：超过 `contextWindow × compaction_trigger_ratio` 时，
  在 `beforeTurn` 把较早一半压成一条 summary，经 `replaceHistory` 落库——`history.replaced`
  事件随写入自动发出并携带完整新状态，事件流投影不会在 compaction 后脱真。

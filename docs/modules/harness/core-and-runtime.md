# Core 与 Runtime

> 范围：harness 引擎主干——`agent/`（原子内核）、`session/`、`event/`、`std/middleware/`、`runtime/`。

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
- 事件总线（`@harness/event/bus.ts`，内核器官）分两个通道，各只有一个发射者：
  - **state**：`StateEvent`（`message.created/updated`、`part.created/delta/updated`、
    `history.replaced`、`session.created`），只由 `Sessions` 发出；消费端用 `@contracts` 的
    `applyStateEvent` 投影回会话状态。
  - **loop**：`LoopEvent`（`session.start`、`turn.start/phase/end`），只由引擎（loop 发
    `session.start`，recorder 发 turn 三帧）发出——活动协议，回答"现在在忙什么"，store 中
    无对应物；middleware 不发遥测。
  - listener 异常按订阅者隔离，订阅方永远炸不掉引擎 turn。
- 词汇定义一次：数据模型与两类事件都在 `@contracts`（依赖方向 contracts ← harness ← surfaces）。
  事件信封自带 `sessionID/rootID`，会话树归属判定是 O(1) 比较。

## 身份模型

没有独立的 "turn" 实体：**一个 turn 产出恰好一条 assistant message**，事件与 hook 里的
`messageID` 永远指被变更/被产出的那条消息。消息不携带 sessionID 回指（归属由包含关系表达）；
`SessionInfo.rootID` 在创建时定根，子会话继承。

## 关键入口

- `@harness/agent/context.ts` — 内核拥有 `EngineDeps` 契约（config、sessions、registries、events）；
  `runtime/context.ts` 的 `RuntimeContext` 即它的别名，组装函数在 runtime 层把 `Sessions` 与
  state 通道接线。
- `@harness/agent/blueprint.ts + create-agent.ts` — 内核的 agent 模块：蓝图（`defineAgent` / `AgentDefinition`）与
  独立原子入口 `createAgent(spec)` 同居一处——模型 + 工具 + middleware 包成一个自带内存会话、
  可直接 `run()` 的单元；完整 runtime 是同一套机件的手工装配。
- `@harness/runtime/bootstrap.ts` — `createRuntime({ config, agents, tools, skills })` 收扁平
  列表直接注册（组合即代码，没有 plugin 间接层）。
- `@harness/agent/loop.ts` — `runSession`（追加 user message）→ `runLoop`（逐 turn 驱动）。顶部注释是生命周期的权威定义。
- `@harness/agent/recorder.ts` — `TurnRecorder`：一个 turn 生命周期的唯一 owner。构造时追加
  assistant message 并发 `turn.start`；持有相位机、流式 part 游标、计数器；`finish/fail/abort`
  恰好终结一次（后到的终态被忽略，abort 与 finish 竞态不会双报）。turn 作用域的累积状态只活在这里——
  `TurnContext` 是不可变输入包，middleware 改不了它。
- `@harness/agent/turn.ts` — 跑单轮：带 retry 地 `ctx.model.stream()`，消费 chunk 写入 recorder，派发工具。
- `@harness/agent/hooks.ts` — `Middleware` 契约与 `HookContext`（只读；状态经 hook 返回值回流引擎）。
- `@harness/agent/policy.ts` — 把 config 与 agent 约束解析成 turn 级执行策略（retry / timeout / budgets）。
- `@harness/session/` — `Sessions` 聚合 + `SessionPersistence`（read/persist/list 三方法契约，
  memory/file 实现）。file 后端：内存为真值、合并刷盘（debounce + 进程退出钩子）、tmp+rename 原子写、
  损坏文件即抛；factory 对未知类型即抛。
- `@harness/agent/tool-part.ts` — 工具调用生命周期：纯状态转换（reducer）+ `ToolPartTracker`，
  后者经 `Sessions.replacePart` 写穿——每次转换同时就是 `part.updated` 事件，无手工镜像。

## 数据流

一次 `runSession` 追加 user message 后进入 `runLoop`，每一步是一个 turn，按固定生命周期推进：

```text
TurnRecorder 构造（追加 assistant message，发 turn.start）
beforeTurn ──(gate 拦截)──► recorder.finish，返回
assembleContext        # 引擎以 agent.instructions 种入草稿；middleware 折叠 system+messages
runTurn:
  stream ─► 收集 tool-call ─► 批量并发执行(beforeToolCall → execute → afterToolCall)
         ─► 干净收束时把 finishReason 开放返回（stop/abort/流错误在此内部落终态）
judgeTurn              # 一次裁决：terminal（仅干净收束时开放）+ outcome
引擎应用 terminal（恰好一次）──(outcome break)──► 返回 ; 否则下一步
```

- **stream 消费**：`agent/turn.ts` 把 reasoning/text 增量交给 recorder（落 part + 自动发
  `part.delta`），并把每个 tool-call chunk 收集到本 turn 的待执行集合。retry 在此层包住
  `model.stream`，是 turn 级关注点（Model 抽象保持薄）。
- **工具并发派发**：流耗尽后，`runToolCalls` 按发起顺序为每个 tool call 开好 tool part（part.created
  确定性入场），再以有界并发整批执行——同时在飞至多 `policy.toolConcurrency` 个。这个界由每个
  turn 独立持有，嵌套 subagent 的扇出各自成界、互不争用。一批全部 settle 后才进入下一 turn，保证每个
  tool call 都有结果可供回放。
- **终态归属**：`agent/turn.ts` 是 turn 终态的唯一所有者，把这批 per-call outcome 归约成单一
  continue/stop（首个 stop/abort 按发起顺序胜出）。`agent/tool-call.ts` 是纯 per-call 执行单元：只经
  tracker 写自己那一个 part，不触碰 recorder 终态，可安全并发。
- **工具结果**：`agent/tool-call.ts` 不发任何事件——一次调用的全部可观测事实就是 tool part 的状态
  转换（`part.created` 开场，`part.updated` 推进到 running/completed/error），由 tracker 写穿产生。
- **裁决**：middleware 的 `judgeTurn` 一次性决定 turn 终态（`terminal`：finish/fail +
  structured + finishReason 覆写）与循环去留（`outcome`：`continue | break`）；budget 与
  structured-output 在这里收口。终态失败而 outcome 仍为 continue 时，引擎兜底改为
  `break/assistant_error`。
- **状态事实来源**：`Sessions` 维护 `messages` 与 `parts`，是项目里最核心的状态来源；
  读取得到的是不可变快照（copy-on-write），持有者无法绕过聚合改状态。
- **预算的作用域各不相同**，读 `TurnBudgetPolicy` 字段名而不是靠直觉：
  - 工具调用：middleware 栈在 `runLoop` 的 while 之外构建一次，所以 budget middleware 的计数器
    **跨整个 run 累加**——`maxRunToolCalls`（agent 的 `maxToolCalls` ?? `config.run_max_tool_calls`）
    是一次 run 的总闸；限制单 turn 并发扇出的是另一个数 `toolConcurrency`。两者混淆会让一次正常的
    长交付物在中途被拒。
  - 步数：`maxAgentSteps`（本 run，与从 1 递增的 `ctx.step` 比）与 `sessionStepsRemaining`
    （整个 session，随 assistant 消息递减）是**两个独立判据**，由 `isFinalAllowedStep()` 统一裁决，
    budget middleware 与 context-assembly 共用它，保证"最后一步"的提示与真正的停止不会错位。
    绝不要把两者 `min()` 成一个数：递增的计数器与递减的余额会在中点相遇，让每个 run 只能用掉
    会话预算的一半——这曾经真实地把长文档渲染腰斩在一半。

## 扩展点

- 新 middleware：实现 `Middleware` 的相关 hook，加入 agent 的 middleware 组合（见 agents-and-tools）。
- 新执行预算/策略：扩展 `agent/policy.ts`，从 config 解析，而不是在 turn 里写死。
- 新持久化后端：实现 `SessionPersistence`（三个方法），接入 `session/persistence.ts` 的 factory。
- 新可观测事实：状态类的加进 `@contracts` 的 `StateEvent` 并让 `Sessions` 的对应 mutator 发出；
  循环遥测类的加进 `LoopEvent`。永远不要在引擎里手工补发状态镜像事件。

## 约束与经验

- **引擎 agent-agnostic**：内核不认识具体 agent；新行为靠 middleware/工具组合，不靠分支。
- **分层是物理事实**，一条向外的直线：
  `contracts ← 基座（event/llm/session/tool/skill 契约、lib）← agent（原子内核）← std（积木）← runtime ← surfaces`。
  内核禁止 import `std/` 与 `runtime/`；基座禁止向上够 `agent/`/`std/`/`runtime/`；std 禁止
  import `runtime/`。由 `check:boundaries` 的 harness-kernel / harness-substrate / harness-std
  规则强制。
- **依赖显式传递**：执行链通过 `RuntimeDeps` 拿依赖；能拿切片就不要持有整个 `RuntimeContext`，
  也不要回退到 `getRuntimeContext()` 式隐式访问。
- **不在聚合内维护启动型单例**，不在 `config.ts` 里写 `initXxx()`。
- compaction 是 session 维护手段而非长期存档：超过 `contextWindow × compaction_trigger_ratio` 时，
  在 `beforeTurn` 把较早一半压成一条 summary，经 `replaceHistory` 落库——`history.replaced`
  事件随写入自动发出并携带完整新状态，事件流投影不会在 compaction 后脱真。

# Loop 与状态

> 范围：`packages/agent-core` 全部——数据模型、循环、会话聚合、事件总线、hook 契约。

## 职责

驱动**一个** agent 跑完一段对话：组装每轮输入、流式消费模型输出、派发那个 agent 持有的工具、
把消息与 parts 写进会话聚合，直到某个 outcome 中断循环。

它不认识 skill、不认识文件系统、不认识"多个 agent"。**agent-agnostic**——行为由 middleware 与
工具注入，而不是在循环里按 agent 身份分支。编排（按名解析 agent、委派、技能目录）属于
它的消费方，见 [harness](../harness/agents-and-tools.md)。

判据（抽取这个包时用的、也是往后判断某样东西该不该进来的）：**一个通用 agent loop 需要它吗**。
不是"它现在被用到了吗"。

## 共享词汇（`model.ts`）

零 import 的纯叶子，一次性定义三样东西：

1. **会话数据模型**：`SessionInfo`（含 `rootID`）、`SessionMessage`、`MessagePart`（text /
   reasoning / compaction / image / tool）。消息不携带 sessionID 回指；assistant message 即
   turn 的记录。tool part 上的 `ToolDisplay` 是工具对自己这次调用的语义描述
   （`verb`/`target`/`summary`），必填——消费端因此无需各写一遍 `?? toolName` 兜底。
   它刻意不含任何排版：措辞属于工具，宽度与配色属于 surface。
2. **两类事件**：`StateEvent`（会话状态变更，由 `Sessions` 聚合在写入时发出）与 `LoopEvent`
   （活动协议：`session.start` / `turn.start` / `turn.phase` / `turn.activity` / `turn.end`，
   只回答"循环现在在忙什么"；一切需要活过回放的事实必须走 state 通道）。事件信封自带
   `sessionID/rootID`，会话树归属判定是 O(1) 比较。
3. **共享投影**：`applyStateEvent`（纯 reducer）+ `partsOf` / `messageText`。折叠一个会话的
   完整状态事件流可精确复原 store 中的会话——这是协议的核心不变量。

纯类型 + 纯函数、浏览器安全：不放运行时状态、不依赖 Node/Bun API，它要能被前端打包。
由 `check:boundaries` 的 `agent-core-model` 规则强制（该文件禁止任何非相对 import）。

## 状态与事件的单一真值链

轴心设计：**状态只有一个出口，事件是写入的副作用**。

- `Sessions`（`session/sessions.ts`）是会话状态的**唯一写入者**。每个 mutator 在同一个方法体内
  完成「构造新不可变快照 → persist → 发 StateEvent」，因此状态事件流在构造上完备：无法改状态
  而不发事件，也无法不改状态而发状态事件。
  不变量测试：`tests/session/state-events.test.ts`（折叠状态事件流 ≡ store 快照）。
- 事件总线（`events.ts`）分两个通道：
  - **state**：只由 `Sessions` 发出；消费端用 `applyStateEvent` 投影回会话状态。
  - **loop**：由循环（`session.start`）、recorder（turn 各帧）、以及**任何 middleware**
    （`turn.activity`）发出。
  - listener 异常按订阅者隔离，订阅方永远炸不掉引擎 turn。
- `turn.activity` 是 middleware 报告自己在做什么的唯一通道。它存在的理由：功能都在 middleware
  里，核心事件词汇却是封闭的——compaction 跑一次完整 LLM 调用、retry 退避四秒，期间界面上和
  卡死无法区分。middleware 拿到的是窄能力 `ctx.activity()` 而不是整条总线，`source` 由
  `MiddlewareStack` 按 `middleware.name` 绑定，调用方不自报家门。
  载荷是语义化的（`label`/`detail`/`status`）而非开放的 `data`——同 `ToolDisplay` 的理由：
  消费端必须能在不知道产出方是谁的情况下渲染它。

## 身份模型

没有独立的 "turn" 实体：**一个 turn 产出恰好一条 assistant message**，事件与 hook 里的
`messageID` 永远指被变更/被产出的那条消息。消息不携带 sessionID 回指（归属由包含关系表达）；
`SessionInfo.rootID` 在创建时定根，子会话继承。

## 关键入口

- `context.ts` — `EngineDeps`：`config` / `sessions` / `events`，三样，就是循环写不出来就跑不了
  的那些。工具需要的其余东西（文件树、技能目录、别的 agent）由工具自己在闭包里持有。
  `createEngineDeps({ config?, events? })` 是它的具名默认工厂：内存持久化、私有总线。
- `blueprint.ts` + `create-agent.ts` — 蓝图（`defineAgent` / `AgentDefinition`，`tools` 是
  `ToolDefinition[]` 而非待解析的名字）与**唯一的创建门径** `createAgent(spec & { deps? })` →
  `Agent`：模型 + 工具 + middleware 包成可直接 `run()` 的单元。`deps` 注入即共享调用方的
  store 与总线（harness 这样建它的每个 agent）；省略即落到 `createEngineDeps()` 的私有内存
  引擎。会话按 `run({ sessionID })` 逐次选择，一个实例服务任意多个会话；种入 user message、
  发 `session.start` 只在 `run()` 里有一份实现。
- `loop.ts` — `runLoop`，逐 turn 驱动，包内私有（不出 barrel——进循环只经 `createAgent`）。
  顶部注释是生命周期的权威定义。
- `recorder.ts` — `TurnRecorder`：一个 turn 生命周期的唯一 owner。构造时追加 assistant message
  并发 `turn.start`；持有相位机、流式 part 游标、计数器；`finish/fail/abort` 恰好终结一次
  （后到的终态被忽略，abort 与 finish 竞态不会双报）。也是 `turn.activity` 的发射点——turn 级
  遥测只有一个所有者。
- `turn.ts` — 跑单轮：把一次流式调用交给 `wrapModelCall` 洋葱，返回它发起的 tool call，
  然后执行那一批。
- `hooks.ts` — `Middleware` 契约（8 个 hook）与 `RunContext` / `HookContext`（只读；状态经 hook
  返回值回流引擎）。
- `policy.ts` — 把 config 与 agent 约束解析成 turn 级执行策略（timeout / budgets）。
- `session/` — `Sessions` 聚合 + `SessionPersistence`（read/persist/list 三方法契约）+
  `MemorySessionPersistence`（未注入时的具名默认）。内核只带契约与内存默认；真实后端
  （file/数据库/远端）是消费方的，以实例注入（`createEngineDeps({ persistence })` /
  harness 的 `createRuntime({ persistence })`）。契约是同步的——流式期间每个 delta 都会
  `persist`，慢后端照 harness file 后端的模式做：内存缓存为真值、write-behind 到介质。
- `tool-part.ts` — 工具调用生命周期：纯状态转换（reducer）+ `ToolPartTracker`，后者经
  `Sessions.replacePart` 写穿——每次转换同时就是 `part.updated` 事件，无手工镜像。
- `llm/fake.ts`、`tool/fake-context.ts` — 随包发布的测试替身。端口是公开的，否则每个消费方
  各手写一份同样的 stub。

## Hook 契约

命名遵循 `<position><Subject>`，整组按执行顺序连读：

```text
beforeRun
  ├─ ( beforeTurn                        门控 + 唯一的副作用点
  │    → beforeModelCall                 纯折叠 (ctx, draft) => draft
  │    → wrapModelCall( 一次流式调用 )     洋葱，retry 落在这里
  │    → ( beforeToolCall → afterToolCall )*
  │    → afterTurn )*                    终态 + 循环去留
  └─ afterRun                            在 finally 里跑
```

- `beforeTurn` 是**承重的副作用点**：compaction 在这里改写 session history，故意不放进纯折叠。
  这也是保留 turn 这个 subject 的原因——LangChain 的 `agent/model/tool` 三分法没有这一层。
- **tool 侧刻意不是 wrap 形态**：门控顺序执行、执行并发（`prepareToolCall` / `executeToolCall`
  分离），因为计数型 guard 只有顺序到达才正确。wrap 包住整个调用会让两个并发调用同时读到
  "还剩 1 次"。model 侧一轮一次调用，没有这个约束。
- `wrapModelCall` 只包**流**，不包它引发的工具批次。因此重试一次失败的流永远不会重放已经执行
  过的工具——重试发生时一个都还没跑。
- `TurnOutcomeReason` 是**开放联合**：循环自己的五个具名，其余是 middleware 的词汇
  （`step_budget_reached` 是 budget middleware 的说法，不是循环知道的事实）。

## 数据流

`runLoop` 每一步是一个 turn，按固定生命周期推进：

```text
TurnRecorder 构造（追加 assistant message，发 turn.start）
beforeTurn ──(gate 拦截)──► recorder.finish，返回
beforeModelCall        # 引擎以 agent.instructions 种入草稿；middleware 折叠 system+messages
runTurn:
  wrapModelCall( stream ) ─► 返回 finishReason + 这轮发起的 tool call
  批量并发执行(beforeToolCall → execute → afterToolCall)
afterTurn              # 一次裁决：terminal（仅干净收束时开放）+ outcome
引擎应用 terminal（恰好一次）──(outcome break)──► 返回 ; 否则下一步
afterRun（finally）
```

- **stream 消费**：`turn.ts` 把 reasoning/text 增量交给 recorder（落 part + 自动发 `part.delta`），
  并把每个 tool-call chunk 收集到本 turn 的待执行集合。
- **工具并发派发**：流耗尽后，按发起顺序逐个 `prepareToolCall`（gate → 校验 → describe）并开好
  tool part（`part.created` 确定性入场、且一次到位带全 display），再以有界并发整批
  `executeToolCall`——同时在飞至多 `policy.toolConcurrency` 个。这个界由每个 turn 独立持有，
  嵌套 subagent 的扇出各自成界、互不争用。一批全部 settle 后才进入下一 turn，保证每个 tool call
  都有结果可供回放。
  派发器**不看工具语义**：它必须在任何工具解析参数之前定下并发度，因而根本无从判断两个调用会不会
  冲突——按工具类别猜（"只读才并发"）只是用一个粗代理指标掩盖这个信息缺口，代价是把并行委派一起
  关掉。一致性归资源持有者。调用之间的**因果顺序**则归模型——一批 tool call 是 provider 层
  "这些可以同时做"的声明，依赖前一个结果的调用属于下一个 turn。
- **终态归属**：`turn.ts` 是 turn 终态的唯一所有者，把这批 per-call outcome 归约成单一
  continue/stop（首个 stop/abort 按发起顺序胜出）。`tool-call.ts` 是纯 per-call 执行单元：只经
  tracker 写自己那一个 part，不触碰 recorder 终态，可安全并发。
- **工具结果**：`tool-call.ts` 不发任何事件——一次调用的全部可观测事实就是 tool part 的状态转换，
  由 tracker 写穿产生。
- **裁决**：`afterTurn` 一次性决定 turn 终态（`terminal`：finish/fail + structured + finishReason
  覆写）与循环去留（`outcome`：`continue | break`）。终态失败而 outcome 仍为 continue 时，
  引擎兜底改为 `break/assistant_error`。
- **状态事实来源**：`Sessions` 维护 `messages` 与 `parts`；读取得到的是不可变快照
  （copy-on-write），持有者无法绕过聚合改状态。
- **预算的作用域各不相同**，读 `TurnBudgetPolicy` 字段名而不是靠直觉：
  - 工具调用：middleware 栈在 `runLoop` 的 while 之外构建一次，所以 budget middleware 的计数器
    **跨整个 run 累加**——`maxRunToolCalls` 是一次 run 的总闸；限制单 turn 并发扇出的是另一个数
    `toolConcurrency`。两者混淆会让一次正常的长交付物在中途被拒。
  - 步数：`maxAgentSteps`（本 run，与从 1 递增的 `ctx.step` 比）与 `sessionStepsRemaining`
    （整个 session，随 assistant 消息递减）是**两个独立判据**，由 `isFinalAllowedStep()` 统一裁决，
    budget middleware 与 `stepGuidance` contributor 共用它，保证"最后一步"的提示与真正的停止不会
    错位。绝不要把两者 `min()` 成一个数：递增的计数器与递减的余额会在中点相遇，让每个 run 只能用掉
    会话预算的一半——这曾经真实地把长文档渲染腰斩在一半。

## 扩展点

- 新 middleware：实现 `Middleware` 的相关 hook。不需要改这个包。
- 新工具：`defineTool()`，把它需要的协作者装进自己的工厂闭包。不需要改这个包。
- 新执行预算/策略：扩展 `policy.ts`，从 config 解析，而不是在 turn 里写死。
- 新持久化后端：实现 `SessionPersistence`（三个方法），以实例注入
  （`createEngineDeps({ persistence })` 或 harness `createRuntime({ persistence })`）。
  不需要改这个包，也永远不给 config 加新的后端字符串。
- 新可观测事实：状态类的加进 `StateEvent` + `applyStateEvent` + 对应 mutator（三处同改，缺一
  不可）。middleware 的活动直接用 `ctx.activity()`，不必扩事件词汇。

## 约束与经验

- **引擎 agent-agnostic**：内核不认识具体 agent；新行为靠 middleware/工具组合，不靠分支。
- **`ToolContext` 显式列举，绝不从 `EngineDeps` 派生。** 它曾经是 `EngineDeps & {...}`，于是
  "工具需要 X"自动变成"引擎必须持有 X"——文件树与技能目录就是这么进内核的。
- **验收测试是这个包干净与否的判据**：`tests/standalone.test.ts` 只用本包搭一个带自定义工具的
  agent 并跑通。任何重新泄漏进来的编排概念，都会表现为那个文件写不出来的 import。
- compaction 是消费方的 middleware，不是这个包的功能。它经 `replaceHistory` 落库——
  `history.replaced` 事件随写入自动发出并携带完整新状态，事件流投影不会在 compaction 后脱真。

# 重构计划：抽出 `agent-core`，harness 成为它的第一个消费者

> **状态**：待执行 · **性质**：一次性迁移计划，不是设计文档
> **完成后删除本文件**，把沉淀下来的设计写进 `docs/conventions.md` 与 `docs/modules/`。
>
> 本文自包含：执行时不需要参考产生它的那次对话。

---

## 1. 目标

把当前单一的 `harness` 包拆成两个，参照 pi(`pi-agent-core` / `pi-coding-agent`)与
LangGraph / LangChain(`langchain-core` / `langgraph`)的分层：

```
packages/agent-core     通用 agent loop。不认识 skill、不认识文件系统、不认识"多个 agent"。
packages/harness        编排层，建立在 agent-core 之上。整个包就是原来的 std/。
```

**这不是把 `harness` 切开，而是把 `agent-core` 立为主体、`harness` 变成它的消费者。**
方向反了会得到不同的结果——见第 2 节。

---

## 2. 唯一判据：构造法，不是减法

执行中每遇到一个"这个归哪层"的问题，问的必须是：

> **一个通用 agent loop 需要这个吗？**

而**不是**：

> 它违反现有边界规则吗？它现在被用到了吗？

两者会给出不同的答案，这是本次重构的核心。三个已查实的实例（都是减法查不出、构造法一秒毙掉的）：

| 东西 | 减法的结论 | 构造法的结论 | 事实 |
| --- | --- | --- | --- |
| `TurnBudgetPolicy.maxSubagentDepth` | 保留（被赋值，不违规） | 删除（通用循环没有 subagent 概念） | 只有声明与赋值，**无人读取**；`task` 读的是 `ctx.config.subagent_max_depth` |
| `getDelegationDepthInfo` | 保留（std 依赖 agent 是允许方向） | 移出（委派不是循环原语） | 定义在 `agent/policy.ts`，**零个内核调用方**，唯一调用方是 `std/tools/task.ts` |
| `agent_registry` | 保留（`runSession` 在用） | 移出（通用循环跑**一个** agent） | `runLoop` 收的已经是 `AgentDefinition` 不是名字；registry 只服务于按名解析 |

**执行时的抗漂移提示**：迁移过程中最强的诱惑是"它能跑、也没违规，就先留着"。
这正是要避免的失败模式。留下来的每一样东西都要能回答"通用 agent loop 需要它"。

### 第二判据：归属看"和谁共享不变量"

当一段逻辑该跟谁走不明显时，看它和谁共享同一个判定/同一份数据。
（例：`getDelegationDepthInfo` 与 `task` 工具共享"谁可被委派"，所以它属于 `task`，
而不是属于"某个 policy 文件"。）

### 第三判据（仅限**契约**）：死代码判据不适用

**"本仓没有实现方"是删除实现的理由，不是删除契约的理由。** 一个扩展点的价值由
"它是否是正确的接缝"决定。判断方式是看独立实现有没有收敛到同一个点上——
`afterToolCall` 本仓零实现，但 pi 有同名 hook、LangChain 有等价的 `wrap_tool_call`，
两个独立设计都认为这个接缝值得存在，那它就是已验证的扩展点。**保留。**

---

## 3. 已定决策（不要重新讨论）

| # | 决策 | 理由 |
| --- | --- | --- |
| 1 | `AgentDefinition.tools` 从 `Record<string, boolean>` 改为 `ToolDefinition[]` | 这是 core 摆脱 `tool_registry` 的关键。"按名声明 + 注册表解析"纯粹是编排层便利（让配置/文件能引用工具），core 里 agent 直接持有工具定义。pi 与 LangChain 均如此。 |
| 2 | `llm/` 留在 `agent-core`，不独立成包 | 目前只有一个消费者。`Model` 是端口、`providers/` 是实现，目录已分开，将来拆是机械操作。（pi 拆成了 `pi-ai`，列为后续演进项，见第 9 节。） |
| 3 | `create-agent.ts` 拆两版 | core 留最小版（`model + tools + middleware + instructions`，私有内存会话）；harness 提供带 `subagents`/skills/workspace 的富版本。 |
| 4 | `packages/contracts` 合并进 `agent-core/src/model.ts` | 单文件 376 行；直接消费者只有 4 个文件且全部去 core；**tui/cli 对 `@contracts` 的直接引用为零**（都走 `@harness` 转口）。一个"通用 agent loop"不拥有自己的数据模型是怪产物。零依赖纪律改用边界规则保住（见 6.3）。 |
| 5 | **hook 命名按 `<position><Subject>` 规整**，并新增 `wrapModelCall` / `beforeRun` / `afterRun` | 见 6.4。当前命名一半语义一半位置（和 pi 同病），**读不出执行顺序**——这正是我们缺的那个维度。 |
| 6 | **retry 从 `turn.ts` 外置为 harness 中间件**（落在新的 `wrapModelCall` 上） | 见 6.6。通用循环需要的是"让人实现重试的接缝"，不是一套特定退避策略。 |
| 7 | **`LoopEvent` 新增 `turn.activity`**；`HookContext` 用窄能力 `activity()` 取代 `events` | 见 6.5。我们把功能都放在中间件里，却配了一个封闭的核心事件词汇——中间件无法报告自己在做什么。 |
| 8 | **保留 `afterToolCall`**（撤回此前的删除提议） | 第三判据。pi 有同名 hook（"blocking tool execution or mutating tool results"），LangChain 有 `wrap_tool_call`。 |

> **决策 4 的翻转条件**：若路线图新增 **web UI / 远程 surface**（浏览器只渲染、引擎在服务端），
> 则 `applyStateEvent` reducer 的远程消费者成立，应把 `model.ts` 拆回独立包。
> 那是一个零依赖纯数据文件，拆回去约 20 分钟、无设计风险。

---

## 4. 目标结构

```
packages/
├── agent-core/
│   └── src/
│       ├── model.ts          ← 原 packages/contracts：消息/part/会话/工具状态/事件词汇/
│       │                        applyStateEvent reducer/partsOf/messageText（纯叶子，零 import）
│       ├── loop.ts           ← runLoop 一个 agent、一个会话，跑到收敛
│       ├── turn.ts hooks.ts blueprint.ts policy.ts
│       ├── recorder.ts outcome.ts tool-call.ts tool-part.ts context.ts
│       ├── error.ts          ← 原 retry.ts 的 isAbortError / toErrorInfo
│       ├── create-agent.ts   ← 最小版
│       ├── session/          sessions.ts persistence.ts index.ts
│       ├── event/            bus.ts
│       ├── llm/              types.ts message.ts image.ts classify.ts index.ts providers/
│       ├── tool/             tool.ts（defineTool + ToolExecutionError）
│       ├── config.ts         仅引擎旋钮
│       ├── types.ts          内核类型（ToolContext 收窄后、ToolDefinition…）
│       └── index.ts
│
├── harness/
│   └── src/
│       ├── agents/           lead/ general/ shared/ index.ts
│       ├── tools/            bash read write edit grep tavily present-files
│       │                     skill task view-image registry.ts index.ts
│       ├── skills/           registry.ts types.ts load.ts
│       ├── middleware/       retry compaction budget doom-loop prompt-assembly
│       │                     structured-output token-estimate view-image index.ts
│       ├── workspace/        local.ts types.ts index.ts
│       ├── runtime/          bootstrap.ts context.ts
│       ├── prompt.ts         slot 词汇 + PromptContributor
│       ├── registry.ts       agent registry
│       ├── session.ts        runSession（按名解析 agent + 追加用户消息 → 调 core 的 runLoop）
│       ├── create-agent.ts   富版本
│       ├── config.ts         扩展 core config
│       ├── format.ts         formatBytes
│       ├── types.ts          编排层类型
│       └── index.ts
│
├── tui/
└── apps/cli/
```

**注意**：`agent-core` 里没有 `agent/` 这层嵌套——整个包就是 agent core。
同理 `harness` 里没有 `std/`——整个包就是那层积木。两者都是"内核和积木挤在一个包里"时期的产物。

---

## 5. 文件级映射（全部 64 个源文件）

### 5.1 → `agent-core`

| 现在 | 去向 | 备注 |
| --- | --- | --- |
| `packages/contracts/src/index.ts` | `agent-core/src/model.ts` | 决策 4；保持零 import；新增 `turn.activity` 变体（6.5） |
| `agent/blueprint.ts` | `agent-core/src/blueprint.ts` | `tools` 字段改类型（决策 1） |
| `agent/context.ts` | `agent-core/src/context.ts` | `EngineDeps` 收窄：去掉 `workspace`、`skill_registry`、`agent_registry`、`tool_registry` |
| `agent/hooks.ts` | `agent-core/src/hooks.ts` | hook 改名 + 新增三个（6.4）；`HookContext` 字段调整（6.4） |
| `agent/loop.ts` | **拆**：`runLoop` → `agent-core/src/loop.ts`；`runSession` → `harness/src/session.ts` | 接缝已存在：`runLoop` 收的是 `AgentDefinition`，`runSession` 才按名解析 |
| `agent/policy.ts` | **拆**：见 5.4 | |
| `agent/retry.ts` | **拆**：见 5.5 | |
| `agent/turn.ts` `outcome.ts` `recorder.ts` `tool-call.ts` `tool-part.ts` | `agent-core/src/` 同名 | `turn.ts` 去掉 retry 包裹，改为走 `wrapModelCall`（6.6）；`recorder.ts` 删除 `retries` / `recordRetry()` |
| `agent/create-agent.ts` | **拆**：最小版 → `agent-core/src/create-agent.ts` | 决策 3 |
| `event/bus.ts` | `agent-core/src/event/bus.ts` | |
| `llm/*`（6 个文件） | `agent-core/src/llm/*` | 决策 2 |
| `session/*`（3 个文件） | `agent-core/src/session/*` | 会话树（`parentID`）是 core 的数据结构 |
| `tool/tool.ts` | `agent-core/src/tool/tool.ts` | |
| `config.ts` | **拆**：见 5.3 | |
| `types.ts` | **拆**：core 类型留下，`AgentInfo` **删除**（见 5.6） | |
| `index.ts` | **拆**：core barrel | |

### 5.2 → `harness`

| 现在 | 去向 |
| --- | --- |
| `agent/registry.ts` | `harness/src/registry.ts` |
| `tool/registry.ts` | `harness/src/tools/registry.ts`（按名声明的便利层，决策 1 后 core 不再需要） |
| `skill/registry.ts` `skill/types.ts` + `std/skills/load.ts` | `harness/src/skills/{registry,types,load}.ts` |
| `workspace/*`（3 个） | `harness/src/workspace/*` |
| `std/agents/**`（7 个） | `harness/src/agents/**` |
| `std/middleware/**`（8 个） | `harness/src/middleware/**`，外加**新增** `middleware/retry.ts`（5.5） |
| `std/tools/**`（11 个） | `harness/src/tools/**` |
| `std/prompt.ts` | `harness/src/prompt.ts` |
| `runtime/*`（2 个） | `harness/src/runtime/*` |
| `lib/format.ts` | `harness/src/format.ts`（只被 read/write 两个工具用） |

### 5.3 `config.ts` 拆分

| → `agent-core/src/config.ts` | → `harness/src/config.ts` |
| --- | --- |
| `session_max_steps` `turn_timeout_ms` | `model_max_retries` `model_retry_base_delay_ms` `model_retry_max_delay_ms`（转为 `createRetry` 入参） |
| `run_max_tool_calls` `tool_max_concurrency` | `workspace_root` `skills_dir` `subagent_max_depth` |
| `session_store` `session_store_dir` | `compaction_trigger_ratio` `compaction_retain_ratio` |

harness 的 config 类型 `extends` core 的。

### 5.4 `policy.ts` 拆分

- **留 core**：`TimeoutPolicy` `TurnBudgetPolicy` `TurnExecutionPolicy`
  `resolveTurnExecutionPolicy` `isFinalAllowedStep` `createTurnAbortSignal` `countAssistantTurns`
- **删除**：`TurnBudgetPolicy.maxSubagentDepth`（死字段）
- **移出**：`RetryPolicy` 与 `TurnExecutionPolicy.retry` → 变成 retry 中间件自己的入参（5.5）
- **并入 `harness/src/tools/task.ts`**：`resolveSessionDepth` `getDelegationDepthInfo`
  （唯一调用方就是 task；按第二判据它们属于 task，不该另起一个 policy 文件）

### 5.5 `retry.ts` 拆分（决策 6）

| 符号 | 去向 | 理由 |
| --- | --- | --- |
| `isAbortError` `toErrorInfo` | `agent-core/src/error.ts` | `turn.ts` 判终态在用，与重试无关 |
| `classifyRetry` `RetryCategory` `RetryClassification` | `agent-core/src/llm/classify.ts` | "这个 provider 错误可不可重试"是 **Model 端口的失败分类**，任何包裹模型调用的人都需要 |
| `retry()` `retryDelay()` `RetryPolicy` | **`harness/src/middleware/retry.ts`**（新文件） | 重试**策略**是可替换行为 |

新中间件形态，和 `createCompaction({ summarizer })` 同构：

```ts
createRetry({ maxRetries, baseDelayMs, maxDelayMs }): MiddlewareFactory
// 实现 wrapModelCall；每轮的尝试计数放在这一次 wrap 调用的闭包里
// 每次重试通过 ctx.activity() 报告（6.5）——今天重试对外完全隐形
```

加入 `baseMiddleware()`，因此**行为不变**。

> 查实：`recorder.retries` 今天是个**纯内部计数器**，只被 `turn.ts` 的 `shouldRetry` 读，
> 不写进消息、不在事件词汇里、TUI 完全看不到。模型 429 退避 4 秒时界面上和卡死无法区分。
> 外置不但没有损失，还顺带修掉这个。

### 5.6 顺带删除的死代码

- `types.ts` 的 `AgentInfo`：唯一用途是 `toolsForAgent(agent: AgentInfo)` 的参数，
  而该函数只读 `.tools`；其 `prompt?: string` 字段全仓无人读写。
  决策 1 之后 `toolsForAgent` 本身也不再需要。
- `TurnBudgetPolicy.maxSubagentDepth`。
- `recorder.retries` / `recorder.recordRetry()`（5.5）。
- `HookContext.rootID`：**零中间件读取**，只有引擎发事件信封时用。

---

## 6. 关键 API 变更

这一节是本次重构里**唯一有设计含量**的部分，其余都是搬家。

### 6.1 `ToolContext` 收窄——解开一切的那个结

```ts
// 现在（types.ts:88）：工具上下文继承引擎依赖，
// 于是"工具需要什么"自动变成"引擎必须持有什么"。
// workspace / skill_registry 就是这么进内核的。
export type ToolContext = EngineDeps & { ... }
```

改为**显式列举 core 自己拥有的东西**：

```ts
export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  toolCallId?: string
  format?: OutputFormat
  messages: SessionHistoryMessage[]
  sessions: Sessions
  events: RuntimeEventBus
  config: Config          // core config
  metadata(...): Promise<void>
  executeTool(...): Promise<...>
}
```

不再有 `workspace`、`skill_registry`、`agent_registry`、`tool_registry`。

### 6.2 工具与 contributor 改工厂，自带依赖

**仓库里已有这个模式**：`createViewImageTool({ model: visionModel })`——view_image 需要视觉模型，
用闭包拿，而不是让内核在 ToolContext 上挂一个 `visionModel`。套用到其余：

```ts
createReadTool({ workspace })   createWriteTool({ workspace })
createEditTool({ workspace })   createGrepTool({ workspace })
createBashTool({ workspace })   createPresentFilesTool({ workspace })
createSkillTool({ skills })
createTaskTool({ agents, tools, config })      // 委派需要 agent registry + 深度配置
createTaskResumeTool({ agents, tools, config })
```

**prompt contributor 同理**——`skill_registry` / `agent_registry` 离开 `HookContext` 之后，
这两个 contributor 也必须改工厂：

```ts
// 现在：从 ctx 上读注册表
export const availableSkills: PromptContributor = (ctx) => ctx.skill_registry.list()
export const subagentList:    PromptContributor = (ctx) => ctx.agent_registry.list()

// 之后：闭包持有
createAvailableSkills({ skills }): PromptContributor
createSubagentList({ agents }): PromptContributor
```

`createCoreTools(deps)` 的入参相应扩展为 `{ visionModel, workspace, skills, agents, tools, config }`。

`ctx.executeTool` 的名字解析改为在 agent 自己的工具数组里查（`agent.tools.find(t => t.id === name)`），
不再需要 registry。

### 6.3 边界规则（`scripts/check-boundaries.ts`）

现有规则里 harness 内部的分层（kernel / substrate / std）整段替换为跨包规则，并新增：

```ts
// 数据模型是纯叶子：它是事件消费者重建状态的唯一依据
{ dir: "packages/agent-core/src/model.ts", forbid: /from\s+["'](?!\.)/,
  why: "数据模型不得依赖任何东西" },

// core 不认识编排层
{ dir: "packages/agent-core/src", forbid: /from\s+["']@harness(\/|["'])/,
  why: "agent-core 是通用循环：它不认识 skill、workspace、多 agent 编排" },

// 保留：surfaces 只走 barrel
```

`tsconfig.base.json` 新增 `@agent-core/*` 别名；`packages/agent-core/tsconfig.json`；
`package.json` workspaces；`scripts/build.ts`；`bun run check` 增加一段 tsc。

### 6.4 Hook 契约（决策 5、8）

三个独立实现收敛到了同一组拦截点，这是对契约形状最有力的验证：

| pi-agent-core | LangChain v1 middleware | 我们（改名后） |
| --- | --- | --- |
| `transformContext` | `before_model` | `beforeModelCall` |
| — | `wrap_model_call` | `wrapModelCall`（**新增**） |
| — | `after_model` | `afterTurn` |
| `beforeToolCall` | `wrap_tool_call` | `beforeToolCall` |
| `afterToolCall` | ↑ 同一个 | `afterToolCall` |
| `agent_start`/`agent_end`（事件） | `before_agent`/`after_agent` | `beforeRun`/`afterRun`（**新增**） |
| — | — | `beforeTurn` |

**改名的理由不是"更好听"，是当前命名读不出执行顺序。** `beforeTurn` 与 `assembleContext`
都在模型调用前跑，从名字看不出谁先谁后（实际是 `beforeTurn` → `assembleContext`）。
采用 `<position><Subject>` 之后整组名字按执行顺序连读：

```
beforeRun ──► ( beforeTurn ─► beforeModelCall ─► wrapModelCall
                           ─► ( beforeToolCall ─► afterToolCall )*
                           ─► afterTurn )* ──► afterRun
```

| 现在 | 改为 | 说明 |
| --- | --- | --- |
| `assembleContext` | `beforeModelCall` | 纯折叠 `(ctx, draft) => draft`，不变 |
| `judgeTurn` | `afterTurn` | 返回类型仍叫 `TurnJudgment`，语义由签名承担 |
| `beforeTurn` | 不变 | 门控 + **副作用**点（compaction 在这里写 session history，故意不放进纯折叠） |
| `beforeToolCall` / `afterToolCall` | 不变 | |
| — | `wrapModelCall(ctx, request, next)` | 洋葱形态，retry 落在这里 |
| — | `beforeRun` / `afterRun` | run 级 setup/teardown |

**为什么不照抄 LangChain 的 subject 划分**：它是 `agent / model / tool`，因为它的执行模型里
**没有 turn 这一层**。我们有——一个 turn = 一次模型调用 + 它那批工具调用，而且 `beforeTurn`
是承重的。丢掉 turn 这个 subject 会把"纯折叠 vs 副作用点"的区分一起丢掉。

**为什么 tool 侧不改成 wrap 形态**：我们刻意让门控顺序执行、执行并发（`turn.ts` 的
`prepareToolCall` / `executeToolCall` 分离），因为计数型 guard 只有顺序到达才正确。
wrap 包住整个调用，并发跑会让两个调用同时读到"还剩 1 次"。model 侧没有这个约束
（一轮一次调用），wrap 干净可用。

**`HookContext` 字段调整**：

- 删 `rootID`（零中间件读取）
- 删 `agent_registry`、`skill_registry`（决策 1/6.2）
- `events` **换成窄能力** `activity()`（6.5）——middleware 不该拿到整条总线，
  它只需要报告自己的活动
- 保留（全部有实读）：`config` `sessions` `agent` `sessionID` `messageID` `step`
  `policy` `abort` `format` `model`

### 6.5 事件契约（决策 7）

**state 通道原样进 core，一个字不改。** `StateEvent` 7 个变体、`TurnPhase` 6 个值全部有发射点，
零死变体；"每次会话变更恰好发一个事件、折叠事件流复现存储态"这个不变量比 LangGraph 的
`values`/`updates` 模式选择更强，是三个参照里最干净的。

**loop 通道缺一个扩展点。** 对比 pi：

```
pi:   agent_start/end · turn_start/end · tool_execution_start/update/end
      compaction_start/end · auto_retry_start/end · queue_update
我们:  session.start · turn.start · turn.phase · turn.end
```

**诱惑是照抄 `compaction_start`，那是错的**——pi 能把 compaction 放进核心事件词汇，是因为
**pi 的 compaction 在核心里**；我们的 compaction 是**中间件**。于是我们撞上一个自己造的矛盾：

> 一个把功能都放在中间件里的架构，却配了一个封闭的核心事件词汇。
> 中间件永远无法告诉 UI 自己在干什么。

后果具体：compaction 要跑一次完整 LLM 调用（数秒到十几秒），期间 `turn.phase` 停在
`"starting"`，和正常启动无法区分；retry 同理（今天连计数都不出内核）。

**新增变体**（沿用现有 `turn.*` 家族与"一个 type + 一个状态字段"的写法，如 `turn.phase`）：

```ts
export type ActivityStatus = "start" | "update" | "end"

| (LoopEnvelope & {
    readonly type: "turn.activity"
    readonly messageID: string
    // 产出方（用于关联 start/end），不供消费者分支渲染
    readonly source: string
    readonly status: ActivityStatus
    // 它在做什么，中间件自己的说法："compacting history" / "retrying model call"
    readonly label: string
    // 可选补充："attempt 2 of 3" / "12k → 4k tokens"
    readonly detail?: string
  })
```

**载荷必须是语义化的，不能是 `data: unknown`。** 本仓已有先例——`ToolDisplay` 让工具声明
`verb`/`target`/`summary`，surface 从不按工具名分支（见 `docs/modules/harness/agents-and-tools.md`）。
开放载荷会逼 TUI 按 `source` 分支，把中间件已经说过的事重新猜一遍。

**中间件侧的发射能力**（取代 `HookContext.events`）：

```ts
// HookContext
readonly activity: (input: { label: string; detail?: string }) => ActivityHandle
// ActivityHandle: { update(detail: string): void; end(detail?: string): void }
```

`source` 由 `MiddlewareStack` 在派发时按 `middleware.name` 绑定，调用方不必自报家门。
这样 middleware 拿到的仍不是整条总线——"middleware 是决策层、event bus 是只读观察层"
这个分工保住了。

**第一个消费者是 retry 中间件**（5.5），不是"为将来准备"。compaction 是第二个。

### 6.6 retry 外置的落点

`turn.ts` 现在把 `runStreamOnce` 包在 `retry({...})` 里。改为：

- `turn.ts` 只负责发起**一次**流式调用，把它交给 `wrapModelCall` 洋葱
- `harness/src/middleware/retry.ts` 实现 `wrapModelCall`：失败时按 `classifyRetry` 判定、
  按 `retryDelay` 退避、重试；每次重试经 `ctx.activity()` 报告
- 计数放在这一次 `wrapModelCall` 调用的闭包里（天然按轮重置），`recorder` 不再持有

`createRetry(...)` 进 `baseMiddleware()`，**行为不变**。

---

## 7. 执行顺序

> **顺序不可调换的一点：先改 API（阶段 B），再搬文件（阶段 C）。**
> 反过来会把错误的契约带进新包，然后被迫跨包边界修——那会痛得多。

### 阶段 A — 契约先行（不动实现）

产出 `packages/agent-core/src/index.ts` 的**草案**：纯类型 + 函数签名，无实现。
必须定死的是第 6 节全部内容，特别是：

- 新的 `Middleware` 类型（6.4 的 8 个 hook，含 `wrapModelCall` 的确切签名）
- `HookContext` 最终字段集 + `activity()` 与 `ActivityHandle`
- `turn.activity` 事件变体（6.5）
- 收窄后的 `ToolContext`（6.1）、`AgentDefinition`（决策 1）

**这一步定错后面全白做。**

- 交付：可评审的 API 草案（放 `docs/plans/agent-core-api.draft.ts`）
- 门禁：人工过一遍

### 阶段 B — 在现包内做 API 变更（不搬文件）

按第 6 节改形状，文件位置全部不动：

1. hook 改名 + 新增 `wrapModelCall` / `beforeRun` / `afterRun`（6.4）
2. `turn.activity` 事件 + `HookContext.activity()`（6.5）
3. retry 外置为 `std/middleware/retry.ts`，进 `baseMiddleware()`（6.6）
4. `ToolContext` 收窄（6.1）
5. 全部工具 + 两个 contributor 改工厂、自带依赖（6.2）
6. `AgentDefinition.tools` → `ToolDefinition[]`，删除 `toolsForAgent` 与 `AgentInfo`
7. `EngineDeps` / `HookContext` 去掉 `workspace`、`skill_registry`、`agent_registry`、`rootID`
8. 删 `maxSubagentDepth`；`resolveSessionDepth`/`getDelegationDepthInfo` 并入 `std/tools/task.ts`
9. `config.ts` 内部拆成两组类型（同文件，`CoreConfig` + `HarnessConfig extends CoreConfig`）

- **每一小步单独可回退，全程 107 个测试必须绿。**
- 门禁：`bun run check && bun run check:boundaries && bun run test:harness && bun run build`

### 阶段 C — 物理拆包（纯机械）

1. 建 `packages/agent-core`（package.json / tsconfig / 别名）
2. 按第 5 节移动文件，改 import 路径
3. `packages/contracts` 内容并入 `agent-core/src/model.ts`，删除该包
4. 更新 `scripts/check-boundaries.ts`（6.3）、`scripts/build.ts`、`bun run check`
5. 测试同步移动：
   `tests/{agent,llm,session}` → `agent-core/tests/`；
   `tests/{std,workspace,tool}` → `harness/tests/`（去掉 `std/` 一层）；
   `tests/support/fake-model.ts` → core，`tool-context.ts` → harness；
   `e2e/` → harness

- 门禁：同上，全绿

### 阶段 D — harness 扁平化

去掉 `std/` 一层，按第 4 节的目标结构就位；`harness/src/index.ts` 重写为编排层 barrel
（不再转口 core 的全部符号——需要 core 的消费者直接依赖 `@agent-core`）。

- 门禁：同上，全绿

### 阶段 E — 验收：用 core 单独搭一个最小 agent

**这是检验 API 是否真的通用的唯一手段**，不是演示。
写一个测试：只用 `@agent-core`，搭一个带单个自定义工具（**不涉及文件系统**）的 agent 并跑通。

要求它**不需要**：workspace、skill registry、agent registry、委派、任何 harness 符号。

如果这一步写不出来，说明 core 还没干净，回到阶段 B。

- 门禁：该测试通过 + 全套基线全绿

---

## 8. 明确不做的事

- **不改任何既有运行时行为。** 全程是结构与契约变更；`bun run test:harness` 的 107 个测试
  除路径与 hook 名外不应需要修改断言。
  唯一的**增量**是 `turn.activity` 事件（新增观察面，不改变任何决策）。
- **不上图执行器。** 是否把循环换成 LangGraph 式的节点图（买到分支 / checkpoint / 中断 /
  可回放）是独立的后续决策，且必须建立在干净的 core 之上。本次不碰。
  自觉接受的代价：我们是 **loop core，不是 runtime core**——会话持久化存的是**内容**，
  不是**执行位置**，"长任务中断后从中间恢复"不是加功能，是换核心抽象。
- **不动 prompt 组装轴。** `promptAssembly` + slot 词汇 + contributor 归属刚刚重构完
  （见 `docs/modules/harness/agents-and-tools.md`），本次只搬位置 + 6.2 的工厂化。

---

## 9. 结转的已知欠账（本次不修，别忘了）

### 功能债

1. **`task` 的 output 不带 child 的终止原因。** `extractTaskResult` 优先取
   `includeSynthetic: false` 的文本，于是"[Stopped: max steps reached]"被丢掉——
   一个被预算腰斩的交付物和一个正常完成的交付物，在 lead 眼里完全一样，
   它也就无从判断该不该 `task_resume`。
2. **lead 的委派判据不可执行。** 现在是 "when that produces a better result"；
   真正的判据（可并行的独立子任务 / 需要隔离上下文的大量读取 值得委派；
   线性长交付 / 需要连续上下文 不值得）目前只写在 `skills/editorial-data-story/SKILL.md` 里，
   只有装载该 skill 才看得到。
3. **工具名缺装配期校验。** agent 声明了未注册的工具时，`Unknown tool: x` 是在
   `runLoop` 的循环体里抛的，不是启动装配时。应在 `createRuntime` 装配时一次性校验。
   （决策 1 之后这个问题形态会变，但校验仍需要。）

### 架构债

4. **`TurnExecutionPolicy` 有和 retry 同类的泄漏。** core 只真读两样：
   `timeout.turnTimeoutMs`（`createTurnAbortSignal`）和 `toolConcurrency`（派发器）。
   `budget.*` 的读者全是 harness 中间件（budget middleware、`stepGuidance` contributor），
   core 只在发 `turn.start` 遥测时取了一次 `maxAgentSteps`。
   **本次不处理**——但它和决策 6 是同一个问题，值得单独定夺。
5. **`harness` 是"剩下的全部"，不是被设计过的边界。** 拆完之后 `agent-core` 边界清晰，
   而 `harness` = agents + tools + skills + middleware + workspace + prompt + registry + runtime。
   pi 的 `pi-coding-agent` 也是这个形态，所以有先例；但下一个自然问题是 `tools/`
   该不该独立成包（让人拿走工具集而不要具体 agent）。别误以为 `harness` 是个设计结论。
6. `llm/` 未来可独立成包（对位 `pi-ai`）。决策 2 只是"现在不拆"。
7. `model.ts` 若出现远程 surface 需拆回独立包（见决策 4 的翻转条件）。
8. **`beforeModelCall` 一个 hook 承担两件事**：写 `system`（`promptAssembly`）与变换
   `messages`（`viewImage`）。目前靠"只有一个中间件写 system"的约定保安全；
   靠约定维系的契约弱于靠类型维系的契约。观察，暂不拆。

---

## 10. 完成后

- 删除本文件与 `docs/plans/agent-core-api.draft.ts`
- 更新 `AGENTS.md`（Doc Map、Core Constraints 里的包结构与别名）
- 更新 `docs/project-map.md`、`docs/conventions.md` 的架构分层一节
- 更新 `docs/modules/harness/core-and-runtime.md` 的生命周期图（hook 改名）
- `docs/modules/` 按新包重新组织（`agent-core.md` + `harness.md`）

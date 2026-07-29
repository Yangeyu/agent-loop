# Runtime 与 Middleware

> 范围：`packages/harness` 的 `runtime/`、`middleware/`、`config.ts`。

## 职责

把 [agent-core](../agent-core/loop-and-state.md) 的循环装配成一个能用的编码 agent：解析配置、
建好协作者（会话存储、事件总线、文件树、技能目录、agent 注册表），把它们喂给工具与 agent 工厂，
再用 middleware 补上循环刻意不提供的行为。

**这一层拥有的每样东西，通用循环都不需要。** 反过来说：某样东西如果通用循环需要，它就不该在这里。

## 关键入口

- `runtime/context.ts` — `RuntimeContext = EngineDeps & { agent_registry, skill_registry, workspace }`。
  两半是分开的类型：循环需要 `config`/`sessions`/`events`；想知道什么是 skill、文件在哪，是这一层
  在想知道。
- `runtime/bootstrap.ts` — `createRuntime({ config, skills })` 建一个不带 agent 的 runtime
  （agent 需要 runtime 的 EngineDeps 才能创建，所以永远是先有 runtime、再注册可运行 agent）；
  `createCoreRuntime({ chat, summarizer, config, skills })` 是标准装配（见下）；`runPrompt()` 跑一次。
- 按名解析发生在用的地方：`runPrompt` 与 `task` 工具各自从 registry 取 agent、调它的 `run()`。
  种入 user message 和进入循环只在 agent-core 的 `run()` 里有一份实现——解析是一个表达式，
  不配一个模块。
- `persistence.ts` — 内建存储后端：`FileSessionPersistence`（内存为真值、合并刷盘、tmp+rename
  原子写、损坏即抛）+ `createSessionPersistence(config)`（`memory` | `file`，未知即抛）。
  内核只带契约与内存默认，「想把会话存在磁盘上」是这一层的选择；外部后端（数据库/远端）
  不加配置字符串，以实例注入 `createRuntime({ persistence })`。
- `config.ts` — zod schema，`Config extends CoreConfig`。核心那四个旋钮加上这层要的
  （session_store/workspace/skills/委派深度/compaction/retry）。
- `middleware/` — `promptAssembly`、`structuredOutput`、`budget`、`doomLoop`、`createCompaction`、
  `createRetry`、`viewImage`、`estimateModelTokens`。

## 标准装配

`createCoreRuntime` 把整条装配收在一处，顺序是承重的：

```text
createRuntimeContext(config)      # sessions / events / workspace / 两个空注册表
  → 注册 skills
  → createCoreTools({ visionModel, workspace, skills, agents, config })
  → createCoreAgents({ model, summarizer, tools, skills, agents, retry, engine: runtime })
  → 注册 agents                   # registry 只准入建在本 runtime store 上的 agent
```

工具先于 agent 建，因为 agent 直接持有 `ToolDefinition[]`（不再按名解析）。而 `task` 工具需要
agent 列表——看似循环依赖，实际不是：传给它的是**注册表**而非数组，它在 `execute` 时才 `list()`。
这也解释了为什么 `registry.ts` 属于这一层：它的价值是**延迟解析**，而通用循环跑的是一个已经
解析好的 agent。注册时校验 `agent.sessions === runtime.sessions`——建在别的 store 上的 agent
会在委派时以「未知会话」的形式在远处失败，所以在装配点就把它拒掉。

surface 只决定 provider（`apps/cli/src/compose.ts` 是唯一的模型绑定点）。

## Middleware 目录

| middleware | hook | 干什么 |
| --- | --- | --- |
| `createRetry` | `wrapModelCall` | 按 `classifyRetry` 判定、指数退避重试；每次尝试经 `ctx.activity()` 报告 |
| `promptAssembly` | `beforeModelCall` | 唯一写 `draft.system` 的那个；按 `SLOT_ORDER` 渲染 contributor |
| `structuredOutput` | `afterStep` | 解析并校验最终文本（配套的 `structuredOutputPrompt` 在同模块） |
| `budget` | `beforeStep` / `beforeToolCall` / `afterStep` | 步数与工具调用预算（配套的 `stepGuidance` 在同模块） |
| `doomLoop` | `beforeToolCall` | 挡住重复的无进展调用 |
| `createCompaction` | `beforeStep` | 超过 `contextWindow × triggerRatio` 时把较早一半压成 summary |
| `viewImage` | `beforeModelCall` | 把 file 类图片源解析成 base64（只碰 `draft.messages`） |

- **retry 是 middleware 而不是循环的一部分**：通用循环需要的是"让人实现重试的接缝"
  （`wrapModelCall`），不是一套特定退避策略。尝试计数活在一次 `wrapModelCall` 调用的闭包里，
  天然按轮重置。
- **compaction 的比率、retry 的次数都是各自的入参**，不是核心 config 字段。默认值与 config 的
  默认值同源（`RETRY_DEFAULTS` / `COMPACTION_DEFAULTS`），组合根从 config 取值传进去。
- **middleware 自包含**：compaction 在模块内建自己的廉价摘要模型，单次 `.stream()` 调用，
  从不走主循环，因此不会重入。

## 扩展点

- 新 middleware：实现 `Middleware` 的相关 hook，加入某个 agent 的 middleware 组合。要报告进度
  就用 `ctx.activity()`——不必扩事件词汇，也拿不到整条总线。
- 新持久化后端 / 新执行预算：在 agent-core 侧扩展（见那边的扩展点）。
- 新 surface：订阅 `runtime.events` 的两个通道即可；数据模型从 `@agent-core` 拿。

## 约束与经验

- **`RuntimeContext` 只由组合根持有**；执行链拿到的是它的切片。能拿 `EngineDeps` 就不要持有整个
  `RuntimeContext`。
- **显式注入，拒绝隐式全局**：注册表、store、事件总线都属于某个 runtime 实例。
- `config.ts` 只做配置解析与校验，不创建运行时对象。
- **`process.cwd()` 只在装配处出现一次**（`config.workspace_root` → `createWorkspace`）。

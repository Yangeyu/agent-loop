# 开发规范与设计原则

`AGENTS.md` 列出的是不可妥协的核心约束；本文给出完整规范，以及随项目沉淀下来的
设计原则。原则部分都写成正向规则——它们是踩过坑后的结论，不是变更记录。

## 架构分层

分层是**包边界**，不是目录约定：

- **`agent-core`（通用循环）**：驱动一个 agent 跑完一段对话。**agent-agnostic**——不认识任何具体
  agent，不按 agent 身份分支；也不认识 skill、文件树、"多个 agent"。行为通过 middleware 与工具注入。
- **`harness`（编排层）**：把循环装配成一个能用的编码 agent——agent 原子、工具、技能、中间件、
  工作区、运行时组合。
- **agent（模块）**：一个 agent 是"能力（prompt + tools + middleware）+ 绑定的 `model` 实例"。
  每个 agent 是一个自包含模块（`harness/agents/lead/`、`general/`），不是一张配置表。
- **middleware（中间件）**：transform/decision 层，按 `hooks.ts` 的生命周期介入。它与只读的事件
  总线是两回事——middleware 拿到的是窄能力 `ctx.activity()`，不是整条总线。
- **prompt（组装轴）**：决定"这个 agent 对模型说什么、按什么顺序说"。与 middleware 是**两条正交
  的轴**：middleware 数组的顺序是执行优先级，contributor 的 slot 是 prompt 顺序。轴只需要一套共享
  词汇（`harness/prompt.ts`），片段本身跟着拥有者走。

> **原则：抽内核用构造法，不用减法。** 判断某样东西该不该在 `agent-core` 里，问的是
> **"一个通用 agent loop 需要它吗"**，而不是"它违反现有边界规则吗 / 它现在被用到了吗"。
> 两者会给出不同的内核，减法系统性地偏大——"它能跑、也没违规，就先留着"是这类判断的主要失败模式。
> 验收手段是 `packages/agent-core/tests/standalone.test.ts`：只用那个包搭一个 agent 并跑通，
> 任何泄漏回去的编排概念都会表现为那个文件写不出来的 import。

> **原则：行为靠组合，不靠分支。** 想让引擎做新事，加一段 middleware 或一个工具，
> 而不是在 core 里加 `if (agent === ...)`。

> **原则：顺序要被声明，不能是排列的副产物。** 系统提示的顺序曾经取决于 middleware 在数组里
> 的位置，于是它同时被三种语义共用，没有人真的决定过提示词长什么样。现在顺序由
> `SLOT_ORDER` 一处决定：`promptAssembly` 是唯一写 `draft.system` 的 middleware，其余中间件
> 只碰 `draft.messages` 或只做门控/裁决。

> **原则：静态文本进 `instructions`，读 `ctx` 的才配 contributor。** 同一句话有两条路径进入
> prompt，就等于没有单一真相。判据看它是否需要运行时信息，不看它属于谁。

> **原则：一条轴不是一个模块。** 新概念不因为刚被命名就配一个目录。判断一段逻辑归属谁，
> 看它**和谁共享不变量**，而不是看它属于哪条轴。`createSubagentList` 和 `task` 工具共享
> "谁可被委派"，`stepGuidance` 和 `budget` 共享 `isFinalAllowedStep`——按轴收编会让这些
> 不变量分居两处各写一遍，正是漂移的来源。轴要的只是一套共享词汇。

> **原则：契约不适用死代码判据。** "本仓没有实现方"是删掉一段**实现**的理由，不是删掉一个
> **扩展点**的理由。扩展点的价值由"它是不是正确的接缝"决定，判断方式是看独立实现有没有收敛到
> 同一个点上——`afterToolCall` 本仓零实现，但 pi 有同名 hook、LangChain 有等价的 `wrap_tool_call`，
> 两个独立设计都认为这个接缝值得存在，那它就是已验证的扩展点。

> **原则：hook 名字要读得出执行顺序。** 命名一半语义一半位置（`beforeStep` 与 `assembleContext`
> 都在模型调用前跑，从名字看不出谁先谁后），就等于把执行顺序藏进了实现。采用
> `<position><Subject>` 之后整组按顺序连读：`beforeRun → beforeStep → beforeModelCall →
> wrapModelCall → beforeToolCall/afterToolCall → afterStep → afterRun`。

> **原则：工具的依赖装进工具的闭包，不挂到上下文上。** `ToolContext` 一旦从 `EngineDeps` 派生，
> "这个工具需要 X"就自动变成"引擎必须持有 X"——文件树与技能目录就是这么进内核的。
> 需要什么，`createXxxTool({ ... })` 自己收。

> **原则：创建只有一扇门，默认值要有名字。** 可运行 agent 一律经 agent-core 的
> `createAgent(spec & { deps? })` 创建，环境（EngineDeps）注入；任何一层都不再包一个自己的创建
> 工厂——`createHarnessAgent` 存在过一天就被删掉了，因为角色（mode）是**组合数据**，同一个 Agent
> 在另一个 runtime 里可以换角色，它属于 `register(agent, { mode })`，不属于 agent 对象。
> 省略 `deps` 落到**具名的** `createEngineDeps()`（pi 的 `SessionManager.inMemory()` 同型）：
> 默认协作者可以存在，但必须是签名上可见的具名值，不是工厂内部的匿名 `new`——匿名构造让 store
> 在调用点没有名字、无法共享，正是当年 seeding 双实现的来源。错配由 registry 准入兜住：
> `register` 校验 agent 与 runtime 同店，把远处的「未知会话」变成装配点的即时失败。
>
> 同一条原则决定实现放哪层：**内核只带契约与内存默认，真实后端属于消费方，以实例注入**。
> `SessionPersistence` 契约 + `MemorySessionPersistence` 在 agent-core，file 后端在 harness
> （LangGraph 的 checkpointer 契约 + `MemorySaver` 在核心、`PostgresSaver` 在外，同一布局）；
> 配置字符串只选内建后端，外部后端永远是实例，不是新的魔法字符串。

## 依赖与边界

- **跨包方向单向**：`agent-core ← harness ← surfaces`（cli/tui）。`agent-core/src/model.ts` 是纯叶子
  （数据模型 + 事件词汇，零 import）；agent-core 不认识 harness，harness 不反向依赖 surface。
  由 `bun run check:boundaries` 强制。
- **只走 barrel**：跨包一律 `@agent-core` / `@harness`，不走深路径。缺符号就往 barrel 里加，
  这样每个包都保有一份被审视过的公开契约。
- **`RuntimeContext` vs `EngineDeps`**：`RuntimeContext` 是完整运行时，只由组合根持有；循环拿到的
  是 `EngineDeps`（config / sessions / events，就这三样）。能拿切片就不要持有整个上下文。
- **显式注入，拒绝隐式全局**：registry、store、event bus 都属于某个 runtime 实例。

> **原则：新的运行时依赖挂到 `RuntimeContext`，不要新增模块级单例或 `getX()` 反查。**
> 唯一允许的模块级缓存是无状态、可重建的惰性单例（如 provider client），且不得捕获可变配置。

## 类型与不可信输入

- 用显式类型和可辨识联合（discriminated union）建模核心运行时数据。
- 把 provider 响应、工具参数、外部 JSON 都当不可信输入：**先解析成类型化结构，
  再进入核心循环**。优先 `unknown` + 收窄，避免 `any`。

> **原则：未知输入要 fail fast，不要静默兜底。** 比如未知的 model id 直接抛错，
> 而不是悄悄回退到默认——否则你以为在跑 A，其实在跑 B。

## 声明式默认值

配置默认值用 schema 的 `.default()` 声明，集中在一处；不要在调用点写 `?? DEFAULT` 散落兜底。
引擎行为配置在 `harness/config.ts`；厂商连接配置归 provider 自己（见 llm 模块）。
middleware 自己的旋钮（retry 次数、compaction 比率）是它工厂的入参，默认值与 config 默认值同源
（`RETRY_DEFAULTS` / `COMPACTION_DEFAULTS`），不进核心 config。

> **原则：默认值有唯一声明处。** 读代码的人在 schema 上就能看全所有默认，不必追散落的 `??`。

## 模块自包含

一个组件需要的东西尽量在自己内部解决，不外溢到上层去配。

- middleware 的逻辑、复用范式、辅助资源自包含。例如 compaction 在模块内建自己的廉价摘要
  模型，单次调用，从不走主循环。
- provider 自带 createModel、模型目录、连接配置；接新厂商是线性扩展，不污染引擎。

> **原则：把决策放在离它最近、最内聚的地方。** 自包含换来的是“加东西不需要改别处”。

## 工具

- 一个工具的 schema、描述、执行逻辑放在一起。
- 横切逻辑（参数校验、错误归一化、metadata、output 截断）走 `defineTool()` 的 hook 与
  归一化阶段，不要散落进每个 `execute()`。
- 工具结果若要在后续轮次被模型感知，必须写回 session part。
- 新工具注册到对应模块的 tools 汇总（core 走 `harness/tools/index.ts`），并传给合适的 agent。
- 工具需要的协作者进工厂闭包（`createReadTool({ workspace })`），不进 `ToolContext`。

## 代码风格

- 无分号、双引号、2 空格缩进。
- 类型导入用 `import type`；TS 源码 import 不加 `.js` 后缀。
- 别名导入：`@agent-core`、`@harness`、`@harness/*`、`@tui/*`；不重新引入 `@/`。
- **注释**：导出 API 用 JSDoc（讲契约：参数、返回、用途）；内部实现用 `//`（讲“为什么”，不复述代码）。
- 优先短函数和清晰的模块边界；只在确实提升可读性/复用/隔离时才引入抽象。

## 测试

- 测试跟着它测的那个包走：`packages/agent-core/tests/`、`packages/harness/tests/`，按源码模块
  分区，不散落在 `src/` 下。
- 不依赖网络：用 `@agent-core` 的 `createFakeModel` 构造 stub `Model`、`createToolContext` 构造
  隔离的工具上下文。两者随包发布——端口是公开的，否则每个消费方各手写一份同样的 stub。
  需要注入辅助模型的 middleware（如 compaction）通过工厂参数注入 fake。
- 根目录跑 `bun run test`（三个包），或 `bun run test:core` / `test:harness` / `test:tui`。

## 验证基线

提交前过一遍：`bun run check`（逐包 tsc）、`bun run check:boundaries`（依赖方向）、
`bun run test`、必要时 `bun run build`。

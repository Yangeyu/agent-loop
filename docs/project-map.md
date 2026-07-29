# 项目地图

## 目标

一个面向 OpenCode 核心行为的精简 TypeScript runtime，保留这几条主线：

- 主循环：user message → model → tool 执行 → session 写回 → 下一步
- 子 agent 委派与 child session 递归
- provider 适配与统一流式 chunk 协议
- 上下文 compaction 与 structured output 注入
- CLI / TUI 两种交互入口

## 顶层结构

分层是**包边界**：`agent-core ← harness ← surfaces`，单向。

```text
packages/
├── agent-core/               # ★ 通用 agent loop，别名 @agent-core
│   └── src/
│       ├── model.ts          # 零 import 的纯叶子：数据模型 + StateEvent/LoopEvent + applyStateEvent
│       ├── loop.ts           # runLoop：一个 agent、一个会话，跑到收敛
│       ├── turn.ts           # 跑单轮：wrapModelCall 洋葱 + 工具批次
│       ├── hooks.ts          # 8 个 hook 的 Middleware 契约 + MiddlewareStack
│       ├── blueprint.ts      # defineAgent / AgentDefinition（tools 是定义数组）
│       ├── create-agent.ts   # createAgent：可运行 agent 的唯一创建门径（环境经 deps 注入）
│       ├── recorder.ts       # TurnRecorder：一个 turn 生命周期的唯一 owner
│       ├── context.ts        # EngineDeps（config/sessions/events）+ createEngineDeps（具名内存默认）
│       ├── policy.ts         # timeout + budgets 解析
│       ├── tool-call.ts tool-part.ts error.ts
│       ├── session/          # Sessions 聚合（唯一写入者）+ SessionPersistence 契约 + 内存默认
│       ├── events.ts         # 双通道总线（state / loop）
│       ├── llm/              # Model 端口 + providers + classify + fake
│       ├── tool/             # defineTool + fake-context
│       ├── config.ts types.ts index.ts
│
├── harness/                  # ★ 编排层：基于 agent-core 的编码 agent，别名 @harness
│   └── src/
│       ├── agents/           # lead、general、shared（baseMiddleware / engineConventions）
│       ├── tools/            # createCoreTools 及内置工具（每个工具自带依赖闭包）
│       ├── middleware/       # retry、compaction、budget、doom-loop、prompt-assembly…
│       ├── skills/           # SKILL.md 目录发现 + registry + 契约
│       ├── workspace/        # 本地文件树的所有者：工具文件访问的唯一入口
│       ├── runtime/          # 组合层：context（RuntimeContext）、bootstrap（createCoreRuntime）
│       ├── persistence.ts    # 内建存储后端（file）+ config 选择；外部后端以实例注入
│       ├── prompt.ts         # slot 词汇 + PromptContributor（只有词汇，片段跟拥有者走）
│       ├── registry.ts       # AgentRegistry：mode 是注册数据（register(agent, { mode })）+ 同店准入
│       ├── config.ts         # Config extends CoreConfig
│       ├── format.ts index.ts
│
└── tui/                      # 交互式终端 UI（opentui/solid），别名 @tui
apps/
└── cli/src/
    ├── index.ts              # CLI 入口（参数解析、CLI/TUI 模式选择）
    ├── compose.ts            # ★ 组合根：唯一的 provider 绑定点
    └── logger.ts             # CLI 渲染（stream / buffered）
skills/                       # 工作区技能：一目录一技能（SKILL.md + 资产），启动时发现
```

## 主执行链路

1. `apps/cli/src/index.ts` 解析参数，选择 CLI 或 TUI；`runPrompt()`（`@harness` 出口）发起一次 session。
2. `apps/cli/src/compose.ts`（组合根）构建模型实例，交给 `createCoreRuntime`。
3. `createCoreRuntime` 装配：注册 skill → 建工具（各自持有 workspace/skills/agents 闭包）→
   以 runtime 自己的 EngineDeps 建 agent（agent-core 的 `createAgent`，唯一门径）→
   `register(agent, { mode })` 注册（mode 是组合数据，不在 agent 对象上）。
4. `runPrompt` 按名（或取默认）从 registry 解析 agent，调它的 `run()` —— 种入 user message、
   发 `session.start`、进入循环都发生在 agent-core 里，且只有这一份实现。
5. 每一步（一个 turn）按生命周期推进：
   `beforeTurn` → `beforeModelCall`（引擎种入 instructions）→ `wrapModelCall`（一次流式调用）
   → 工具批次 → `afterTurn`（终态 + 去留一次裁决）。
6. `agent-core/turn.ts` 经 `TurnRecorder` 把 text/reasoning/tool-call 写进 Sessions（状态事件随写入自动发出）。
7. 工具经 `defineTool` 统一校验/执行/归一化；文件访问一律经工具自己持有的 `workspace`；
   `task` 创建 child session 后直接调 delegate 的 `agent.run()`——同一个 store 与总线由
   registry 准入保证。
8. middleware 塑形结果：retry 包住模型调用，compaction 在 `beforeTurn` 压缩超长上下文，
   budget/structured-output 在 `afterTurn` 收口。
9. `events.ts` 分 state/loop 两通道广播，由 `apps/cli/src/logger.ts`（CLI）或 `tui/app.tsx`（TUI）
   订阅渲染。middleware 经 `ctx.activity()` 在 loop 通道上报告自己在做什么。

> 主链路的完整生命周期注释以 `agent-core/src/loop.ts` 顶部为准。

## 组合即代码

- `harness/runtime/bootstrap.ts`：`createCoreRuntime({ chat, summarizer, config, skills })` —— 标准装配。
- `harness/agents/index.ts`：`createCoreAgents({ model, summarizer, tools, skills, agents, retry, engine })`。
- `harness/tools/index.ts`：`createCoreTools({ visionModel, workspace, skills, agents, config })`。
- `apps/cli/src/compose.ts`：唯一的 provider 绑定点。skill 来自 `config.skills_dir`
  （默认 `./skills`，相对运行目录解析，不存在即视为没有）——加技能不必改这个文件。
- `agent-core/create-agent.ts`：`createAgent(spec & { deps? })` —— 唯一的创建门径。
  harness 注入 runtime 的 EngineDeps；独立嵌入省略 deps，落到具名的 `createEngineDeps()`
  私有内存引擎。会话按 `run({ sessionID })` 逐次选择，一个 agent 实例服务任意多个会话。

## 扩展点

- **新 agent**：在 `harness/agents/` 下新建原子模块（工厂：prompt + middleware + tools，模型与
  `engine`（runtime 的 EngineDeps）经参数注入，内部走 agent-core 的 `createAgent`），加入
  `createCoreAgents` 或在组合根 `register(agent, { mode })`。
- **新 tool**：`defineTool()` 定义；需要协作者的导出工厂，把它装进闭包。加入 `createCoreTools`
  或消费方工具列表，并传给合适的 agent。
- **新 middleware**：实现 `agent-core` 的 `Middleware`（8 个 hook 挑需要的），加入 agent 的 middleware 组合。
- **新 prompt 片段**：写一个 `PromptContributor` 并声明 slot，**放在它所描述的那个模块里**
  （工具/中间件/agent），由该 agent 的 `baseMiddleware([...])` 传入；顺序由 `SLOT_ORDER` 决定，
  不由注册位置决定。
- **新 provider**：在 `agent-core/llm/providers/` 新建 `create<Vendor>Model`，自带 `ConnectionSchema`；
  走 OpenAI 兼容端点就建在 `createOpenAICompatModel` 之上。
- **不需要编排层的场景**：直接依赖 `@agent-core`，用 `createAgent` 搭一个带自定义工具的 agent
  （形态见 `packages/agent-core/tests/standalone.test.ts`）。

## 初始化约束

- `config.ts` 只做配置解析与校验，不创建运行时对象。
- `harness/runtime/context.ts` 是运行时依赖的唯一组合根。
- `Sessions` 是状态唯一写入者；持久化后端只实现 read/persist/list 三方法，不维护启动型单例。
- `workspace/` 是文件树唯一所有者：`process.cwd()` 只在装配处出现一次，工具里不再有 `node:fs`。
  共享可变资源要么有所有者，要么就得靠调用方处处自律——后者迟早会漏。
- 新的跨模块运行时依赖优先挂到 `RuntimeContext`，避免扩散隐式全局状态；
  只被少数几个工具需要的，挂进那些工具的工厂闭包，不要挂到 `ToolContext`。

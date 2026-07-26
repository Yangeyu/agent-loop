# Agent 与 Tool

> 范围：harness 的 agent 内核原子、`std/agents/`、`tool/` 契约与 `std/tools/`。

## 职责

定义“谁来做事”和“能做什么事”。一个 agent 是**能力 + 绑定模型**：prompt、工具开关、middleware
组合，加一个 `model` 实例。tool 负责具体执行。两者正交——agent 决定策略，tool 决定动作。

## 关键入口

- `@harness/agent/blueprint.ts` — agent 蓝图：`defineAgent()`、`AgentDefinition`（能力 + `model`）。
- `@harness/agent/create-agent.ts` — 独立原子入口 `createAgent()`（见 core-and-runtime）。
- `@harness/std/agents/lead/`、`@harness/std/agents/general/` — 两个核心 agent 原子，各为自包含模块
  （`index`（工厂）+ `prompt` + `middleware`）。
- `@harness/std/agents/shared/` — `base-prompt`、`base-middleware`：agent 间复用的基线。
- `@harness/agent/registry.ts` — agent registry 工厂；实例由 `RuntimeContext.agent_registry` 持有。
- `@harness/tool/tool.ts` — `defineTool()`，core tool harness 的统一入口。
- `@harness/std/tools/index.ts` — `createCoreTools({ visionModel })` 汇总（view_image 需注入视觉模型）。
- `@harness/std/tools/task.ts` — `task` / `task_resume`，子 agent 委派原语。
- `@harness/std/skills/load.ts` — skill 发现积木：`loadSkillsFromDir(dir)` 按 Agent Skills 目录约定（子目录/SKILL.md，YAML frontmatter 携带 name/description）解析为 `SkillInfo[]`；内核契约仍是纯数据，来源（目录/DB/内联）由组合根决定。
  文件来源的 skill 额外带上 `dir`（可选字段），`skill` 工具据此在加载时列出同目录资产的**绝对路径**——
  SKILL.md 正文习惯写 `./template.html`，而 `read` 相对 CWD 解析，把路径直接给出比让模型自行推导更可靠。

## 数据流

**Agent**：`createCoreAgents({ model, summarizer }) = [lead, general]`。

- `lead` — 主 agent、默认入口、最完整工具权限，倾向直接完成任务，必要时委派 specialist。
- `general` — 通用 subagent，承接 `task` 创建的 child session，也可被 `task_resume` 续跑。
- **agent 原子是工厂**：声明"需要一个 `Model`"（接口），不声明"用哪个 provider"（实现）。
  prompt、middleware 组合在原子目录内装配，模型由组合根注入（provider 绑定只存在于
  `apps/cli/src/compose.ts` 一处）。引擎按名解析 agent，但不认识其内部——行为通过该 agent 的
  middleware 与工具进入循环。原子之间只经 registry 按名引用，禁止互相 import。

**Tool**：一个 tool 经 `defineTool()` 走统一执行顺序：

```text
参数校验 → beforeExecute → execute → afterExecute → output/metadata 归一化 → 写回 session ToolPart
```

- 横切逻辑集中在 hook：`beforeExecute`（写执行前已知的 title/路径/workdir/delegate 目标）、
  `mapError`（把失败映射成稳定 `ErrorInfo.code`）、`afterExecute`/`normalizeMetadata`（修整结果与 metadata）。
- `ToolContext` 提供受控的 `executeTool()`，让嵌套工具调用复用标准执行路径，而不绕开
  core/tool-part（ToolPartTracker）/budget/event 边界。
- 同一 turn 内的多个 tool call 由引擎整批并发执行（见 core-and-runtime 的"工具并发派发"），工具自身
  只实现单次调用即可。
- core 工具：`task`、`task_resume`、`bash`、`read`（UTF-8 文本 + Office/PDF 文档解析、大小上限与截断）、
  `write`、`grep`、`tavily`、`present_files`、`skill`、`view_image`。
- `read`/`write` 是文件系统能力的两半：`write` 支持 `overwrite`/`append` 两种 mode，output 只回报
  写入字节与文件当前总大小（不回显内容——模型刚发出的内容再回灌一遍会让长文档的上下文成本翻倍）。
  这个累计总量是分段生成的反馈信号：一份长文档由多次小 `append` 累积而成，避免单次超大生成撞上
  turn 超时而前功尽弃。
- `task` 创建 child session、校验 `subagent_max_depth`、递归回 `runSession`，子 agent 结束后把最终文本
  作为普通 tool output 返回父上下文；`task_resume` 复用已有 child session。

## 扩展点

- 新 agent：在 `std/agents/` 下建原子模块（导出 `createXxxAgent(deps)` 工厂），明确
  `mode`/`steps`/`maxToolCalls`/`tools` 边界，由组合根注入模型并加入装配列表。
  `steps` 与 `maxToolCalls` 同构：都是 agent 对自身工作形态的声明，缺省时回落到 config 默认值。
  产出长交付物的 agent（如 `lead`）需要读技能、读资产、再分段写文件，预算按这个形态给，
  而不是按一问一答给。
- 新 tool：`defineTool()` 定义（schema/描述/执行放一起）；需要模型等依赖的导出工厂。加入
  `createCoreTools` 或消费方自己的工具列表，并为合适的 agent 开启。
- 新 agent middleware：实现 `Middleware` hook，加入该 agent 的组合，而不是改引擎。
- 独立嵌入一个 agent：`agent/create-agent.ts` 的 `createAgent({ model, tools, middleware, instructions })`，
  不需要完整 runtime 装配。

## 约束与经验

- **agent 即模块**：prompt、middleware、model 自包含在 agent 目录里；不要回到一张集中配置表。
- **不在 core 写死业务委派目标**：可委派范围在 `task` 工具层按 `mode === "subagent"` 过滤，registry 不加专用 API。
- registry（agent/tool/skill）属于运行时依赖，由入口从 `RuntimeContext` 装配，经 `RuntimeDeps`/`ToolContext` 传递，不依赖模块级全局表。
- tool 横切逻辑放 `defineTool()` 的 hook，不散落进 `execute()`；结果若要被后续轮次感知，必须写回 session part。
- tool metadata key 用 camelCase（`taskId`、`sessionId`、`boardId` 等）。

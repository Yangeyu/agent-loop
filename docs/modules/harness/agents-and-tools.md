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
                     ── 顺序 ──                          ── 并发 ──
gate(beforeToolCall) → 参数校验 → describe → 开 ToolPart → beforeExecute → execute
                                                          → afterExecute → 归一化 → 写回 ToolPart
```

- **决策顺序、执行并发**（`agent/tool-call.ts` 的 `prepareToolCall` / `executeToolCall`）。
  一批 tool call 先按发起顺序逐个走「能不能跑、跑什么」：middleware gate、参数校验、`describe`。
  这不是可以绕开的限制——**计数型 guard（budget、doom-loop）只有顺序到达才是对的**，
  并发跑会让两个调用同时读到「还剩 1 次」；而 display 必须在开 part 之前算出来（见下）。
  准备很轻且不阻塞，真正耗时的 `execute` 才是并发的那一半。
- `describe(args, ctx)` 是纯同步函数，只从参数推出「这次调用是关于什么」。它在**开 part 之前**运行，
  于是 `part.created` 一次到位，不需要后续更新来补。`ctx` 只给 `workspace`/`config`——
  路径要和工具执行时用同样的方式解析，行里显示的才是这次调用真正会碰的那个文件；
  而 part 此刻还不存在，写 metadata、嵌套调用这些都刻意不给。
- `metadata` 会被序列化成 `<metadata>` 一并发给模型（见 `llm/message.ts`），所以它**只放 output 与
  title 说不出来的事实**。`beforeExecute` 里写 `{ filePath: args.filePath }` 这类是把模型自己刚发出的
  参数读回给它——三处重复（title、output、metadata）每次调用都要付一遍上下文；失败路径也不需要，
  `tool-error` 本来就带完整 `input`。派生字段同理（`succeeded` 可由 `exitCode`/`timedOut` 算出）。
- 其余横切逻辑仍在 hook：`beforeExecute`（执行前的 metadata，现在只有 grep 的搜索根、bash 的
  workdir 这类调用方推不出来的事实还用它）、
  `mapError`（把失败映射成稳定 `ErrorInfo.code`）、`afterExecute`/`normalizeMetadata`（修整结果与 metadata）。
- `ToolContext` 提供受控的 `executeTool()`，让嵌套工具调用复用标准执行路径，而不绕开
  core/tool-part（ToolPartTracker）/budget/event 边界。
- 同一 turn 内的多个 tool call 由引擎整批并发执行（见 core-and-runtime 的"工具并发派发"），工具自身
  只实现单次调用即可，也无须为并发做任何事——文件一致性由 `ctx.workspace` 保证。
- core 工具：`task`、`task_resume`、`bash`、`read`（UTF-8 文本 + Office/PDF 文档解析、大小上限与截断）、
  `write`、`edit`、`grep`、`tavily`、`present_files`、`skill`、`view_image`。
- 文件能力只有三件：`read` 读、`write` 创建或整体替换、`edit` 改已有内容。**没有 `append`**：
  它曾作为 `write` 的一个 mode 存在，用来分段生成长文档，后来独立成工具，最后被整个删掉。
  理由是 `append` 严格劣于 `edit`——它是**盲写**，不知道文件当前是什么状态，前一步写错或失败了
  照样往后接；而且分段追加的每个中间态都是非法文档（标签跨调用才闭合）。
  `edit` 每次必须匹配锚点，锚点没了就响亮失败。
  长文档的正确形态是**先 `write` 一个完整骨架**（每处内容留一个短小唯一的占位标记），
  **再逐个 `edit` 替换占位**：文件在任何时刻都合法，锚点长度固定不随文档增长，
  某一段失败只影响那一段。
- `edit` 用**锚点唯一替换**（`oldString` 逐字匹配且必须唯一），不是 diff：模型只需原样复制一段
  文本，没有语法负担；不唯一/不匹配/改了等于没改，一律响亮失败。
  它刻意**不做「忽略空白后再试一次」的降格匹配**——那是受控的静默兜底，与本项目
  fail fast 的取向冲突，也正是补丁落到错误位置的典型成因。取而代之的是**诊断**：精确匹配失败时
  再做一次忽略缩进的搜索，只用来告诉调用方「第 N 行内容一致但缩进不同」。诊断不等于应用。
- `edit` 的读-改-写整体交给 `workspace.mutate`：匹配逻辑是纯函数（拿到当前文本，决定新文本），
  抛出即不落盘。工具因此不持有任何锁，也不知道有没有别的调用在跑。
- `write` 的 output 只回报写入字节数（不回显内容——模型刚发出的内容再回灌一遍会让长文档的
  上下文成本翻倍）；`edit` 回报改动落在第几行以及周围几行，作为「确实改对了地方」的回执。
  分段是必要的：模型单次输出有上限，一份由它原创生成的长文档必然拆成多步，
  否则单次超大生成会撞上 turn 超时而前功尽弃。
- **每个工具自报 `ToolDisplay`**（`@contracts`）：`verb`（干了什么）、`target`（对什么干的，
  完整不缩写）、`summary`（结果，工具自己的说法）。
  它是语义，不是排版——工具不知道视口多宽，绝不预拼字符串；截断、分隔、配色由 surface 决定。
  `describe` 声明「这次调用是关于什么的」，执行结果只补「结果如何」，
  `agent/tool-part.ts` 的 `resolveDisplay` 按字段合并，未声明 `verb` 时回落到工具名——
  于是不实现 display 的工具照样能正常显示。
  这一份数据同时喂给三个消费者：TUI transcript、CLI logger、以及发给模型的 tool-output 标题。
  在任何一个消费者里按工具名分支，都是把工具已经说过的事重新猜一遍。
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
- **`mapError` 只处理工具自己分类不了的失败**。工具主动抛出的 `ToolExecutionError` 已经是最精确的
  说法，`defineTool` 会原样放行，不再过 `mapError`——否则 `edit_not_unique` 会被泛化成
  `tool_execution_failed`，调用方就失去了唯一能指导它改正的信息。
- **工具不直接碰 `node:fs` / `process.cwd()`，一律走 `ctx.workspace`**。这不是风格约定：文件树
  一旦是隐式全局，就没有任何对象为它的一致性负责，并发安全只能从外部补——每个调用点加锁，或让
  引擎整批串行。前者要求每个工具作者都记得，后者结构上做不到（派发器必须在参数解析前定下并发度，
  它根本不知道涉及哪些路径）。`Workspace` 把这份保证变成资源持有者的内在性质，工具因此不需要声明
  任何调度提示。曾经真实损坏过文件的「两个 `edit` 并发读-改-写」，现在由 `workspace.mutate` 的
  按路径互斥消除，见 [core-and-runtime](core-and-runtime.md) 的"工作区"。

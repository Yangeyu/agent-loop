# Agent 与 Tool

> 范围：`packages/harness` 的 `agents/`、`tools/`、`skills/`、`workspace/`、`prompt.ts`、`registry.ts`。
> 循环本身与工具/middleware 契约在 [agent-core](../agent-core/loop-and-state.md)。

## 职责

定义“谁来做事”和“能做什么事”。一个 agent 是**能力 + 绑定模型**：prompt、工具开关、middleware
组合，加一个 `model` 实例。tool 负责具体执行。两者正交——agent 决定策略，tool 决定动作。

## 关键入口

- `@harness/registry.ts` — agent registry 工厂：`register(agent, { mode })`，只准入建在本 runtime
  store 上的 agent。`mode`（primary/subagent）是**注册数据而非 agent 身份**——同一个 Agent 在另一个
  runtime 里可以换角色，所以创建始终是 agent-core 的 `createAgent`，外面不包任何一层。`mode` 住在
  这一层而不是核心里：通用循环跑一个 agent，没有委派概念。
- `@harness/agents/lead/`、`@harness/agents/general/` — 两个核心 agent 原子，各为自包含模块
  （`index`（工厂）+ `prompt`）。
- `@harness/agents/shared/` — `base-middleware.ts`（`baseMiddleware(prompt?, retry?)`，agent 复用的
  执行栈 + 普适 contributor）、`base-prompt.ts`（`engineConventions`）。
- `@harness/prompt.ts` — prompt 组装的**共享词汇**：slot 定义、`SLOT_ORDER`、`PromptContributor`。
  只有词汇，没有片段——每个片段跟着它的拥有者走。
- `@harness/middleware/prompt-assembly.ts` — `promptAssembly()`，唯一写 `draft.system` 的 middleware。
- `@harness/tools/index.ts` — `createCoreTools({ visionModel, workspace, skills, agents, config })`：
  每个工具在自己的工厂闭包里持有它需要的协作者。
- `@harness/tools/task.ts` — `task` / `task_resume`，子 agent 委派原语。
- `@harness/skills/load.ts` — skill 发现积木：`loadSkillsFromDir(dir)` 按 Agent Skills 目录约定（子目录/SKILL.md，YAML frontmatter 携带 name/description）解析为 `SkillInfo[]`；内核契约仍是纯数据，来源（目录/DB/内联）由组合根决定。
  文件来源的 skill 额外带上 `dir`（可选字段），`skill` 工具据此在加载时列出同目录资产的**绝对路径**——
  SKILL.md 正文习惯写 `./template.html`，而 `read` 相对 CWD 解析，把路径直接给出比让模型自行推导更可靠。

## 数据流

**Agent**：`createCoreAgents({ model, summarizer, tools, skills, agents, retry, engine }) = [lead, general]`。
`createCoreRuntime()`（`runtime/bootstrap.ts`）把这段装配收在一处：先注册 skill，再建工具，
再以 runtime 的 EngineDeps 建持有那些工具的 agent。顺序是承重的——`task` 在调用时才读 agent
registry，因此可以先于 agent 存在；agent 不能先于它的工具存在，也不能先于 runtime 存在
（它的 `run()` 就跑在 runtime 的 store 和总线上）。

- `lead` — 主 agent、默认入口、最完整工具权限，倾向直接完成任务，必要时委派 specialist。
- `general` — 通用 subagent，承接 `task` 创建的 child session，也可被 `task_resume` 续跑。
- **agent 原子是工厂**：声明"需要一个 `Model`"（接口），不声明"用哪个 provider"（实现）。
  prompt、middleware 组合在原子目录内装配，模型由组合根注入（provider 绑定只存在于
  `apps/cli/src/compose.ts` 一处）。引擎按名解析 agent，但不认识其内部——行为通过该 agent 的
  middleware 与工具进入循环。原子之间只经 registry 按名引用，禁止互相 import。

**Prompt**：一个 agent 对模型说的话由**两类来源**汇合，经 `promptAssembly` 按 slot 渲染：

```text
AgentDefinition.instructions ──引擎 seed──┐
                                          ├─► promptAssembly ─► draft.system: string[]
PromptContributor[]（读 ctx 的动态片段）──┘        按 SLOT_ORDER 分组
```

- **slot 决定顺序，注册顺序不决定顺序**。`SLOT_ORDER = identity → convention → capability →
  policy → volatile`（`prompt.ts`）。往 `baseMiddleware([...])` 末尾追加一个
  contributor，是给 agent 加一项能力，不是往系统提示尾部追加一段话。
- **两个直接后果**：agent 自己的身份声明必然排在最前（不再被通用前言压住）；每步都变的
  `volatile`（步数提示）必然排在最后，其上全部是可被 provider 当作稳定前缀缓存的内容。
- **静态文本进 `instructions`，读 `ctx` 的才配 contributor**。这是判据，不是偏好——同一句话
  两条路径进入 prompt，就是"没有单一真相"，`deliverableGuidance` 曾经就是这个反例
  （一个只 append 静态字符串、签名里 `ctx` 都用不上的 middleware），现已并回 `GENERAL_INSTRUCTIONS`。
- **contributor 跟着拥有者走，不集中收编**。组装轴是一条轴，不是一个模块——它需要的只有一套
  共享词汇（`prompt.ts`），不需要一个目录。每个片段和它描述的那件事同模块导出两半：

  | contributor | 同模块的另一半 | 共享的那个东西 |
  | --- | --- | --- |
  | `stepGuidance` | `budget` middleware | `isFinalAllowedStep` |
  | `structuredOutputPrompt` | `structuredOutput` middleware | `hasStructuredOutputFormat` |
  | `createAvailableSkills` | `skill` 工具 | 同一份 `SkillRegistry` |
  | `createSubagentList` | `task` 工具 | `isDelegable`（准入判据） |
  | `engineConventions` | 无（普适基线） | — |

  判据是**它和谁共享不变量**。把它们收进一个 `prompt/` 目录，就等于让"告诉模型能委派谁"
  和"决定能不能委派"分居两处，各写一遍 `mode === "subagent"`——广告的集合与受理的集合从此
  可以悄悄分叉。注册表从 `HookContext` 撤走之后，这两个 contributor 与它们的工具一样改成工厂，
  闭包里持有同一个注册表实例，共享因此从"约定"变成"同一个引用"。
- 装配点即索引：`baseMiddleware([...])` 的参数列出了这个 agent 说的全部动态片段，
  一个 agent 开了哪个能力工具，就在这里传入对应的 contributor。

**Tool**：一个 tool 经 `defineTool()` 走统一执行顺序：

```text
                     ── 顺序 ──                          ── 并发 ──
gate(beforeToolCall) → 参数校验 → describe → 开 ToolPart → beforeExecute → execute
                                                          → afterExecute → 归一化 → 写回 ToolPart
```

- **决策顺序、执行并发**（agent-core 的 `tool-call.ts`）。
  一批 tool call 先按发起顺序逐个走「能不能跑、跑什么」：middleware gate、参数校验、`describe`。
  这不是可以绕开的限制——**计数型 guard（budget、doom-loop）只有顺序到达才是对的**，
  并发跑会让两个调用同时读到「还剩 1 次」；而 display 必须在开 part 之前算出来（见下）。
  准备很轻且不阻塞，真正耗时的 `execute` 才是并发的那一半。
- `describe(args)` 是纯同步函数，只从参数推出「这次调用是关于什么」。它在**开 part 之前**运行，
  于是 `part.created` 一次到位，不需要后续更新来补。它**只收参数**：要把路径解析成工具真正会碰
  的那个文件，用的是工具自己闭包里的 workspace，不需要引擎递一个上下文进来。
- `metadata` 会被序列化成 `<metadata>` 一并发给模型（见 `llm/message.ts`），所以它**只放 output 与
  title 说不出来的事实**。`beforeExecute` 里写 `{ filePath: args.filePath }` 这类是把模型自己刚发出的
  参数读回给它——三处重复（title、output、metadata）每次调用都要付一遍上下文；失败路径也不需要，
  `tool-error` 本来就带完整 `input`。派生字段同理（`succeeded` 可由 `exitCode`/`timedOut` 算出）。
- 其余横切逻辑仍在 hook：`beforeExecute`（执行前的 metadata，现在只有 grep 的搜索根、bash 的
  workdir 这类调用方推不出来的事实还用它）、
  `mapError`（把失败映射成稳定 `ErrorInfo.code`）、`afterExecute`/`normalizeMetadata`（修整结果与 metadata）。
- `ToolContext` 提供受控的 `executeTool()`，让嵌套工具调用复用标准执行路径，而不绕开
  core/tool-part（ToolPartTracker）/budget/event 边界。
- 同一 step 内的多个 tool call 由引擎整批并发执行（见 agent-core 的"工具并发派发"），工具自身
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
  否则单次超大生成会撞上 step 超时而前功尽弃。
- **每个工具自报 `ToolDisplay`**（`@agent-core`）：`verb`（干了什么）、`target`（对什么干的，
  完整不缩写）、`summary`（结果，工具自己的说法）。
  它是语义，不是排版——工具不知道视口多宽，绝不预拼字符串；截断、分隔、配色由 surface 决定。
  `describe` 声明「这次调用是关于什么的」，执行结果只补「结果如何」，
  agent-core `tool-part.ts` 的 `resolveDisplay` 按字段合并，未声明 `verb` 时回落到工具名——
  于是不实现 display 的工具照样能正常显示。
  这一份数据同时喂给三个消费者：TUI transcript、CLI logger、以及发给模型的 tool-output 标题。
  在任何一个消费者里按工具名分支，都是把工具已经说过的事重新猜一遍。
- `task` 创建 child session、校验 `subagent_max_depth`，然后直接调 delegate 的 `agent.run()`
  （同店由 registry 准入保证），子 agent 结束后把最终文本作为普通 tool output 返回父上下文；
  `task_resume` 复用已有 child session。

## 扩展点

- 新 agent：在 `agents/` 下建原子模块（导出 `createXxxAgent(deps)` 工厂），明确
  `mode`/`steps`/`maxToolCalls`/`tools` 边界，由组合根注入模型并加入装配列表。
  `steps` 与 `maxToolCalls` 同构：都是 agent 对自身工作形态的声明，缺省时回落到 config 默认值。
  产出长交付物的 agent（如 `lead`）需要读技能、读资产、再分段写文件，预算按这个形态给，
  而不是按一问一答给。
- 新 tool：`defineTool()` 定义（schema/描述/执行放一起）；需要模型等依赖的导出工厂。加入
  `createCoreTools` 或消费方自己的工具列表，并为合适的 agent 开启。
- 新 agent middleware：实现 `Middleware` hook，加入该 agent 的组合，而不是改引擎。
- 新 prompt 片段：写一个 `PromptContributor` 并声明 slot，**放进它所描述的那个模块**
  （工具/中间件/agent），经 `baseMiddleware([...])` 传入。**不要**在 middleware 里往
  `draft.system` 追加。
- 独立嵌入一个 agent：`@agent-core` 的 `createAgent({ model, tools, middleware, instructions })`，
  不需要 harness。

## 约束与经验

- **agent 即模块**：prompt、middleware、model 自包含在 agent 目录里；不要回到一张集中配置表。
- **两条轴分开**：middleware 数组的顺序是**执行优先级**（gate 依次门控、fold 依次折叠），
  contributor 的 slot 是**prompt 顺序**。这两件事曾经挤在同一个数组里——想调整提示词的排版，
  唯一手段是改一个同时影响预算判定顺序的数组，于是没有人真的"决定"过系统提示长什么样，
  它是排列的副产物。`promptAssembly` 是唯一写 `draft.system` 的 middleware；其余 middleware
  只碰 `draft.messages`（如 view-image）或只做门控/裁决。
- **内核不懂 prompt 语义**：slot 词汇整个住在 harness，`ContextDraft.system` 对内核而言只是
  "一个有序字符串列表"。现在这是包边界的事实而不再只是约定——`PromptContributor` 住在
  `@harness`，agent-core 引用它就是反向依赖。
- **不在 core 写死业务委派目标**：可委派范围在 `task` 工具层按 `mode === "subagent"` 过滤，registry 不加专用 API。
- **注册表不进 `ToolContext`**：需要它们的工具在自己的工厂闭包里持有。`RuntimeContext` 装配
  实例并传给工厂，循环全程不知道它们存在。
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
  按路径互斥消除。

## 工作区

`workspace/` 是本地文件树的所有者：`types.ts` 定契约，`local.ts` 是文件系统实现。它替代了工具里
散落的 `node:fs` + `process.cwd()`——后者是隐式全局，没有所有者，也就没人能为并发下的一致性负责。
保证由机制给出而非约定：`write` 经同目录 rename 原子发布（读者只会看到完整的旧或新，不会读到
截断的中间态），`mutate`（唯一的读-改-写）按路径互斥。读操作因此无需任何协调。
`cwd` 只在装配处出现一次（`config.workspace_root`）。
边界不在此列：绝对路径仍可指到 root 之外，沙箱是另一个关注点、另一个实现。

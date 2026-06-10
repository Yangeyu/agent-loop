# Agent 与 Tool

> 范围：harness 的 `agent/` 与 `tool/`。

## 职责

定义“谁来做事”和“能做什么事”。一个 agent 是**能力 + 绑定模型**：prompt、工具开关、middleware
组合，加一个 `model` 实例。tool 负责具体执行。两者正交——agent 决定策略，tool 决定动作。

## 关键入口

- `@harness/agent/types.ts` — `defineAgent()`、`AgentDefinition`（能力 + `model`）。
- `@harness/agent/lead/`、`@harness/agent/general/` — 两个核心 agent，各为自包含模块（`index` + `prompt` + `middleware`）。
- `@harness/agent/shared/` — `base-prompt`、`base-middleware`：agent 间复用的基线。
- `@harness/agent/registry.ts` — agent registry 工厂；实例由 `RuntimeContext.agent_registry` 持有。
- `@harness/tool/tool.ts` — `defineTool()`，core tool harness 的统一入口。
- `@harness/tool/tools.ts` — `coreTools` 汇总。
- `@harness/tool/task.ts` — `task` / `task_resume`，子 agent 委派原语。

## 数据流

**Agent**：`coreAgents = [leadAgent, generalAgent]`。

- `lead` — 主 agent、默认入口、最完整工具权限，倾向直接完成任务，必要时委派 specialist。
- `general` — 通用 subagent，承接 `task` 创建的 child session，也可被 `task_resume` 续跑。
- 每个 agent 把 prompt、middleware 组合、绑定的 `model` 在自己的模块里装配；引擎按名解析 agent，
  但不认识其内部——行为通过该 agent 的 middleware 与工具进入循环。

**Tool**：一个 tool 经 `defineTool()` 走统一执行顺序：

```text
参数校验 → beforeExecute → execute → afterExecute → output/metadata 归一化 → 写回 session ToolPart
```

- 横切逻辑集中在 hook：`beforeExecute`（写执行前已知的 title/路径/workdir/delegate 目标）、
  `mapError`（把失败映射成稳定 `ErrorInfo.code`）、`afterExecute`/`normalizeMetadata`（修整结果与 metadata）。
- `ToolContext` 提供受控的 `executeTool()`，让 `batch` 这类组合工具复用标准执行路径，而不绕开
  core/tool-part（ToolPartTracker）/budget/event 边界。
- core 工具：`task`、`task_resume`、`batch`、`bash`、`read`、`grep`、`present_files`、`skill`、`view_image`。
- `task` 创建 child session、校验 `subagent_max_depth`、递归回 `runSession`，子 agent 结束后把最终文本
  作为普通 tool output 返回父上下文；`task_resume` 复用已有 child session。

## 扩展点

- 新 agent：在 `agent/` 下建模块，明确 `mode`/`steps`/`tools` 边界与绑定 `model`，加入 `coreAgents` 或由插件提供。
- 新 tool：`defineTool()` 定义（schema/描述/执行放一起），注册到 `tool/tools.ts` 或模块私有 tools，并为合适的 agent 开启。
- 新 agent middleware：实现 `Middleware` hook，加入该 agent 的组合，而不是改引擎。

## 约束与经验

- **agent 即模块**：prompt、middleware、model 自包含在 agent 目录里；不要回到一张集中配置表。
- **不在 core 写死业务委派目标**：可委派范围在 `task` 工具层按 `mode === "subagent"` 过滤，registry 不加专用 API。
- registry（agent/tool/skill）属于运行时依赖，由入口从 `RuntimeContext` 装配，经 `RuntimeDeps`/`ToolContext` 传递，不依赖模块级全局表。
- tool 横切逻辑放 `defineTool()` 的 hook，不散落进 `execute()`；结果若要被后续轮次感知，必须写回 session part。
- tool metadata key 用 camelCase（`taskId`、`sessionId`、`boardId` 等）。

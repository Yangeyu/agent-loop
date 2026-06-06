# Agent 与 Tool 模块说明

## 模块职责

这一层定义“谁能做事”和“能做什么事”：agent 负责策略、工具开关和步数限制，tool 负责具体执行。

## 相关文件

- `packages/harness/src/agent/registry.ts`
- `packages/harness/src/agent/agents.ts`
- `packages/harness/src/agent/prompts.ts`
- `packages/harness/src/skill/registry.ts`
- `packages/harness/src/tool/registry.ts`
- `packages/harness/src/tool/tools.ts`
- `packages/harness/src/tool/basic.ts`
- `packages/harness/src/tool/bash.ts`
- `packages/harness/src/tool/batch.ts`
- `packages/harness/src/tool/task.ts`
- `packages/harness/src/tool/tool.ts`
- `packages/harness/src/session/tool-part.ts`
- `packages/harness/src/module.ts`

## Agent 体系

`packages/harness/src/agent/registry.ts` 定义 agent registry 工厂；实际 registry 实例由 `packages/harness/src/runtime/context.ts` 创建并持有，支持：

- `register()`
- `get()`
- `list()`
- `defaultAgent()`

当前核心 agents：

- `build`: 主 agent，默认入口，拥有最完整的工具权限。
- `general`: 通用 subagent，适合被 `task` 工具创建的 child session 承接中间调查，也可被 `task_resume` 继续复用。

registry 维护全局 agent 定义，用于：

- 按名字解析当前 session 或 child session 要运行的 agent
- 提供完整 agent 列表，供 `task` 在工具层过滤可委派的 subagents

## Agent Prompt

`packages/harness/src/agent/prompts.ts` 中的 prompt 主要描述策略，不做实现：

- `build` 倾向直接完成任务，必要时委派 specialist
- 不在 core 中写死业务模块的委派目标

## Tool 注册

`packages/harness/src/tool/tools.ts` 汇总 core tools：

- `task`
- `task_resume`
- `batch`
- `bash`
- `read`
- `grep`
- `skill`

`packages/harness/src/tool/registry.ts` 定义 tool registry 工厂；实际 registry 实例由 `RuntimeContext.tool_registry` 持有，并根据 agent 的 `tools` 开关筛选当前 step 可用工具。

## Tool Harness

`packages/harness/src/tool/tool.ts` 提供 `defineTool()`，作为 core tool harness 的统一入口。

当前一个 tool 的标准执行顺序是：

- 参数校验
- `beforeExecute`
- `execute`
- `afterExecute`
- output / metadata 归一化
- 结果写回 session tool part

tool 结果在真正落进 session history 前，还会经过 `packages/harness/src/session/tool-part.ts` 的稳定 `ToolPart` 协议收口。当前稳定字段包括：

- `toolName`
- `toolCallId`
- `state.status`
- `state.input`
- `state.title`
- `state.metadata`
- `state.output`
- `state.attachments`
- `state.error.code` / `state.error.message` / `state.error.retryable`
- `state.time.start` / `state.time.end`

这层协议是给 session replay、compaction、board 等消费者使用的稳定边界；runtime event、provider chunk、hook 临时上下文等调试细节不应直接落进这层结构。

tool metadata key 约定优先使用 `camelCase`，例如：

- `taskId`
- `sessionId`
- `parentSessionId`
- `boardId`
- `sourceDataId`
- `agentName`
- `subagentName`

`defineTool()` 当前统一处理：

- 参数校验错误包装
- 执行期错误归一化（`mapError`）
- 执行前 metadata 预写入（`beforeExecute`）
- 执行后结果修整（`afterExecute`）
- metadata 归一化（`normalizeMetadata`）
- 可选 output 截断（`truncateOutput`，默认关闭）

`ToolContext` 目前除 runtime deps 和 metadata/structured-output capture 之外，还提供受控的 `executeTool()` 能力，供 `batch` 这类组合工具复用标准 tool execution path，而不是绕开 session/tool-part/budget/event 边界直接调用其他 tool。

各 hook 的职责建议：

- `beforeExecute`
  - 写入标题、路径、workdir、timeout、delegate 目标等“执行前就已知”的元信息
- `execute`
  - 只负责真正做事并返回结果
- `afterExecute`
  - 基于执行结果补充 title、metadata、output、attachments
- `mapError`
  - 把具体 tool 的失败原因映射为稳定的 `ErrorInfo.code`
- `normalizeMetadata`
  - 统一整理 metadata 结构，避免每个 tool 自己手工拼装最终形态

## 关键工具职责

- `basic.ts`
  - `read`: 读取工作区内 UTF-8 文本文件
  - `grep`: 在 `src/` 下的 TypeScript 文件中执行正则搜索
- `skill.ts`
  - `skill`: 按需加载 runtime 已注册的 specialized skill 内容
  - skill 正文不会预先全部塞进 system prompt；system prompt 只暴露可用 skill 列表，真正需要时再通过 tool 注入 `<skill_content ...>`
- `bash.ts`
  - 在本地工作区执行 shell 命令
  - 支持 workdir、timeout、abort、元数据回写
  - 返回的 metadata 至少包含 `command`、`workdir`、`exitCode`、`timedOut`、`succeeded`
- `batch.ts`
  - 用于并发执行多个独立工具调用
  - 子调用会复用统一 tool execution path，继续写入标准 `ToolPart`、遵守 tool budget 和 failure policy
  - 聚合 metadata 会记录调用数量和工具列表，便于 trace 和 replay
- `task.ts`
  - `task`: 创建新的 child session
  - `task_resume`: 复用已有 child session
  - 调用子 agent 再次进入 `SessionPrompt.prompt()`
  - 可委派 agent 列表来自 `agentRegistry.list()`，再在 `task` 工具层过滤 `mode === "subagent"`
  - 创建或续跑 child session 前，会校验 `subagent_max_depth`，避免无限递归委派
  - 子 agent 结束后，`task` 读取 child session 的最终文本结果，并把它作为普通 tool output 返回给父上下文
  - delegation result metadata 统一记录 `taskId`、`sessionId`、`parentSessionId`、`agentName`、`subagentName`、`resume` 等关键字段
  - 创建 child session 后，会立刻补发一次带 `sessionId` 的 tool metadata 更新；前端可用 `title` / `description` 作为该子任务 CoT 区块标题，而不必等子任务结束

board 模块当前的最终报告落盘逻辑保持在 `packages/backend/src/board/tools/board-report-write.ts`，`task` 本身不再承担 artifact 透传协议。

## 设计重点

- agent/tool registry 属于运行时依赖，应由入口层从 `RuntimeContext` 装配，再通过 `RuntimeDeps` / `ToolContext` 往执行链传递，而不是依赖模块级全局表。
- skill registry 与 agent/tool registry 一样属于运行时依赖，挂在 `RuntimeContext.skill_registry`，由 app/plugin 通过 `RuntimePlugin.skills` 静态声明具体 skill 内容。
- 当前 subagent 委派采用平铺式可见模型：所有 `mode: "subagent"` 的 agents 都可作为 delegation 目标；可委派范围的过滤在 `task` 工具层完成，而不是在 registry 层增加专用 API。
- tool 执行链优先通过 `ToolContext` / `RuntimeDeps` 显式拿到 `agent_registry`、`tool_registry`、`session_store`。
- tool 的 schema、描述、执行逻辑尽量放在一起。
- tool 的横切逻辑优先放到 `defineTool()` 的 hook 和归一化阶段，而不是散落在每个 `execute()` 中。
- tool 结果若需要在后续轮次被模型感知，必须写回 session part。
- `task` / `task_resume` 是最重要的编排原语，因为它们把多 agent 协作落成了递归 session，并把“新建”和“续跑”两种语义拆开。

## 扩展建议

- 新增 tool 时，先定义 `ToolDefinition`，再注册到对应模块。
- 新增 agent 时，明确 `mode`、`steps`、`tools` 边界，避免主/子 agent 职责混乱。

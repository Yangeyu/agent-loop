# Runtime 与 Session 模块说明

## 模块职责

这是项目的主循环核心，负责注册模块、创建 session、驱动多步推理、写回消息与 parts，并在上下文过长时执行 compaction。

## 相关文件

- `packages/harness/src/config.ts`
- `packages/harness/src/runtime/bootstrap.ts`
- `packages/harness/src/runtime/context.ts`
- `packages/harness/src/plugin/manager.ts`
- `packages/backend/src/compose.ts`
- `packages/harness/src/session/prompt.ts`
- `packages/harness/src/session/processor.ts`
- `packages/harness/src/session/processor-context.ts`
- `packages/harness/src/session/tool-executor.ts`
- `packages/harness/src/session/execution-policy.ts`
- `packages/harness/src/session/turn-lifecycle.ts`
- `packages/harness/src/session/tool-part.ts`
- `packages/harness/src/session/store/`
- `packages/harness/src/session/model-message.ts`
- `packages/harness/src/session/system.ts`
- `packages/harness/src/session/compaction.ts`
- `packages/harness/tests/`
- `packages/harness/src/types.ts`

## 配置与运行时上下文

- `packages/harness/src/config.ts` 只负责环境变量解析、schema 校验、默认值和缓存读取，不负责创建任何运行时依赖。
- `packages/harness/src/runtime/context.ts` 负责创建新的 `RuntimeContext` 实例，把 `config`、`session_store`、`agent_registry`、`skill_registry`、`tool_registry`、`events` 装配在同一个 runtime 上。
- `packages/harness/src/runtime/trace.ts` 负责订阅 runtime events，收集 turn-level trace，并通过 `RuntimeContext.trace` 暴露导出接口。
- `packages/harness/src/runtime/replay.ts` 负责基于 session state 和 trace 重建指定 turn 的模型输入快照，并通过 `RuntimeContext.replay` 暴露查询接口。
- `packages/harness/src/session/execution-policy.ts` 负责把 runtime config 和 agent 约束解析成 turn 级执行策略。
- `packages/harness/src/runtime/bootstrap.ts` 负责把传入的 runtime plugins 注册到 runtime，或通过 `createRuntime()` 一次性创建并装配新的 runtime 实例。

### RuntimeContext vs RuntimeDeps

- `RuntimeContext` 表示完整运行时，只应由 bootstrap、CLI 入口、TUI 入口这类组合根持有；每次调用 `createRuntime()` 都会得到一套独立实例。
- `RuntimeDeps` 是执行链依赖切片，包含 `config`、`agent_registry`、`skill_registry`、`session_store`、`tool_registry`、`events`，供 `SessionPrompt`、`SessionProcessor`、tool execute context 等内部链路传递。
- `runPrompt()` 现在要求调用方显式传入 `runtime`，不再负责隐式初始化运行时。
- 规则上，能拿 `RuntimeDeps` 的地方就不要持有 `RuntimeContext`；只有需要创建/装配/启动运行时的边界模块才应该碰 `RuntimeContext`。

当前约束：

- 不要在业务模块里直接 new store/provider 等具体实现。
- 不要在 `config.ts` 里新增 `initXxx()` 风格的启动逻辑。
- 新的全局运行时依赖应优先接入 `RuntimeContext`，而不是再引入新的模块级单例。
- `AgentRegistry` / `ToolRegistry` / `RuntimeEventBus` 都应属于某个 runtime 实例，而不是进程级全局状态。
- 核心执行链必须通过 `RuntimeDeps` 显式传递依赖，不要回退到隐式 `getRuntimeContext()` 风格访问。

## Runtime bootstrap

`packages/harness/src/runtime/bootstrap.ts` 现在通过 plugin manager 按 runtime 实例遍历 plugins：

- 创建新的 `RuntimeContext`
- 对 plugin 名称做重复保护，并保证同一个 runtime 上的重复注册是幂等的
- 向 `RuntimeContext.tool_registry` 注册每个插件暴露的 tools
- 向 `RuntimeContext.agent_registry` 注册每个插件暴露的 agents
- 向 `RuntimeContext.skill_registry` 注册每个插件静态声明的 skills
- 在最小插件模型下支持可选 `setup` / `dispose` 生命周期
- 返回这套已装配完成的 runtime，供 CLI、TUI、测试或脚本独立使用

这让 core/board 之类的能力以插件方式接入，而不是散落在入口文件里；具体装配集合由 `app/` 负责，而不是让 core 反向依赖业务插件。

## SessionPrompt: 外层循环

`packages/harness/src/session/prompt.ts` 是 session 驱动入口：

- 创建 user message 与文本 part
- 发出 `session-start`
- 进入 `while (true)` loop
- 每一步根据当前 user/agent/tool 状态创建 assistant message
- 调用 `SessionProcessor.process()` 执行当前 step
- 根据结果决定 `continue`、`break` 或 `compact`

这里同时处理两类关键行为：

- agent step 限制
- structured output tool 的动态注入

## SessionProcessor: 单步执行器

`packages/harness/src/session/processor.ts` 是每一轮 assistant turn 的执行器：

- 调用 `LLM.stream()` 获得统一 chunk 流
- 将 reasoning/text 增量写入 session parts
- 处理 tool-call chunk，校验参数后执行工具
- 把 tool result / tool error 归一化成稳定的 `ToolPart` 结构后写回 session
- 处理 finish / error / abort

它不负责决定是否开始下一轮，只返回 `continue | stop | compact` 给外层 loop。

当前内部实现已按职责拆成几个协作对象：

- `processor.ts` 只保留 turn orchestration、stream loop 与重试控制
- `execution-policy.ts` 统一提供 retry、timeout、step/tool budgets、repeated failure threshold
- `processor-context.ts` 集中维护 step 执行上下文与结果判定
- `turn-lifecycle.ts` 统一负责 turn phase、生命周期事件、assistant 写回，以及 outcome 的 continue / stop / compact 收口
- `tool-executor.ts` 负责 tool-call 的校验、执行、失败策略与 tool context 组装

这样把“流程编排”“turn lifecycle 收口”“工具执行”分开，避免 processor 本身继续膨胀。

当前 runtime event 流属于 `runtime.events`，会在模型调用发生可重试错误时发出 `retry` 事件，包含 `attempt`、`delayMs`、`category`、`reason` 和错误消息，方便 logger 或上层观察重试行为。

当前还会为每个 turn 发出最小 trace 事件，供后续 replay / eval / 调试使用：

- `turn-input`: 当前 turn 的输入快照，包括 `system`、启用的 `tools`、`messageCount`
- `turn-outcome`: 当前 turn 的收口结果，包括 `continue | compact | break` 以及显式 `reason`

`RuntimeContext.trace` 会基于这些事件收集导出的 turn trace，当前最小字段包括：

- `sessionID`、`agent`、`messageID`、`turnID`、`step`
- `system`、`tools`、`messageCount`
- `toolCalls`
- `retries`
- `budgetHits`
- `outcome`
- `finishReason`、`durationMs`、`aborted`、`error`

`RuntimeContext.replay` 当前提供最小 replay 入口：

- `turnInput({ sessionID, turnID })`
- `turnInput({ sessionID, step })`

返回结果会重建当时的：

- `system`
- `tools`
- `messages`
- 可直接复用的 `llmInput`

当前 replay 只负责重建输入快照，不负责再次执行 provider。

CLI 当前已经提供最小调试出口：

- `bun run start --trace "..."`
- `bun run start --replay-step <n> "..."`
- `bun run start --replay-turn <id> "..."`

这些出口直接读取当前 runtime 实例上的 `trace` / `replay`，因此只覆盖本次 CLI 进程内执行过的 turn。

当 execution policy 命中 budget 上限时，还会发出 `budget-hit` 事件：

- `session_steps`: 整个 session 的累计 assistant turn 用尽
- `agent_steps`: 当前 prompt loop 的 agent step 用尽
- `subagent_depth`: child session 嵌套深度超限
- `tool_calls`: 单 turn tool call 数超限
- `tool_failures`: 相同 tool failure 连续触发阈值

当前 turn 执行策略统一从 runtime config 解析：

- retry: `model_max_retries`、`model_retry_base_delay_ms`、`model_retry_max_delay_ms`
- timeout: `turn_timeout_ms`
- budget: `agent.steps`、`session_max_steps`、`turn_max_tool_calls`、`repeated_tool_failure_threshold`、`subagent_max_depth`

其中：

- `agent.steps` 仍然表示单次 prompt loop 的 agent step 上限。
- `session_max_steps` 表示整个 session 生命周期内累计 assistant turns 的总预算；继续复用同一个 session 时，会扣减已用 budget。
- `subagent_max_depth` 表示 child session 的最大嵌套深度；root session depth 为 `0`，第一层 subagent child 为 `1`。

## SessionStore: Store 接口与运行时适配

`packages/harness/src/session/store/` 现在分成三层：

- `types.ts`: `ISessionStore` 边界接口
- `memory.ts` / `file.ts`: 具体实现
- `factory.ts`: 根据配置创建 store

运行时默认通过 `RuntimeContext.session_store` 持有实际 store，业务模块通过显式依赖读取该 store，而不是从模块级单例反查。

store 负责维护 session 状态：

- `messages` 记录 user/assistant 消息
- `parts` 记录 reasoning/text/tool/compaction 等细粒度内容
- 通过 append/update API 统一修改 session 状态

当前 tool part 持久化协议已经单独收口为稳定字段：

- 基础字段：`id`、`type`、`toolName`、`toolCallId`
- `state.status`
- `state.input`
- `state.title`
- `state.metadata`
- `state.output` / `state.attachments` / `state.error`
- `state.time.start` / `state.time.end`

`packages/harness/src/session/tool-part.ts` 负责把运行中的 tool 调用归一化成这套稳定 `ToolPart` 结构，避免 board 或其他消费者直接依赖 processor 内部中间态。

这是项目里最核心的状态事实来源，但初始化职责不再放在 store 模块内部。

## System prompt 与模型消息

- `packages/harness/src/session/system.ts` 负责拼装每一步系统提示，包括最终步警告、available skills 提示与 structured output 约束。
- `packages/harness/src/session/model-message.ts` 负责把 session 内部消息映射为 provider 可消费的 `ModelMessage[]`。

## Compaction

`packages/harness/src/session/compaction.ts` 在消息数达到阈值后，把最近历史压缩成 `compaction` part，并只保留最新 user message 继续执行。

目的不是长期存档，而是给后续 step 保留足够上下文摘要，避免循环被上下文长度卡死。

当前 compaction summary 不只保留 user/assistant 文本，也会把最近 tool 调用结果压缩成摘要行：

- completed tool: `tool <toolName> (<title>): <output excerpt>`
- errored tool: `tool <toolName> error: <error excerpt>`
- 如果 tool metadata 含关键标识，会附加到摘要里，例如 `taskId`、`sessionId`、`boardId`、`sourceDataId`

这样在历史消息被裁剪后，后续 step 仍能从 compaction part 理解最近做过哪些关键工具调用和结果。

## 阅读建议

- 先读 `config.ts` 和 `runtime/context.ts` 看初始化边界。
- 再读 `prompt.ts` 看整体 loop。
- 然后读 `processor.ts` 看单步内如何消费 stream 和执行 tool。
- 最后读 `session/store/` 和 `compaction.ts` 看状态如何保存与压缩。

## 测试布局

- `packages/harness` 的测试现在统一放在 `packages/harness/tests/`，不再散落在 `src/` 下。
- 测试目录按源码模块分区，便于集中运行和管理，例如 `tests/session/`、`tests/middleware/`、`tests/tool/`。
- 推荐从仓库根目录执行 `bun run test:harness`，或在包内执行 `bun run test`。

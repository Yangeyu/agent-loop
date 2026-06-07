# 入口与界面模块说明

## 模块职责

这一层负责把用户输入接入 runtime，并把运行中的事件渲染成 CLI、TUI 或 SSE 体验。

## 相关文件

- `apps/cli/src/index.ts`
- `packages/backend/src/server.ts`
- `packages/backend/src/http/`
- `frontend/`
- `packages/tui/src/app.tsx`
- `packages/tui/src/components/`
- `packages/tui/src/trace.ts`
- `packages/tui/src/theme.ts`
- `packages/tui/src/types.ts`
- `packages/harness/src/runtime/logger.ts`
- `packages/harness/src/runtime/events.ts`

## CLI 入口

`apps/cli/src/index.ts` 负责：

- 解析 `--agent`、`--session`、`--json`、`--trace`、`--replay-step`、`--replay-turn`、`--tui`、`--output`。
- 在启动时调用 `createRuntime()` 创建并装配新的 runtime 实例。
- 测试和 smoke 脚本可调用 `createTestRuntime()`，默认使用 memory store 并支持覆写 config/modules。
- 无 prompt 且在交互终端中时，默认进入 TUI。
- 有 prompt 时，通过 `runPrompt()` 触发一次完整 session turn。
- 当启用 `--trace` / `--replay-*` 时，在 turn 完成后打印当前进程内 runtime 收集到的 trace 或 replay 调试快照。

当前 CLI 调试出口约束：

- `--session <id>` 允许在 CLI 中继续已有 session。
- `--trace` 打印当前这次 CLI 运行里，该 session 的 turn trace。
- `--replay-step <n>` 或 `--replay-turn <id>` 打印对应 turn 的 replay 输入快照。
- replay 依赖当前 runtime 内存里的 trace，因此不能只靠磁盘 session 文件离线恢复旧 trace。
- `--trace` / `--replay-*` 仅支持 CLI 模式，不支持 `--tui`。
- 根脚本 `bun run dev` 会先选一个固定可用后端端口，再用 `bun --watch packages/backend/src/server.ts` 启动后端，并把同一个地址注入 `frontend/` 开发服务器。

## SSE 入口

`packages/backend/src/server.ts` 负责：

- 作为轻量启动入口，启动 `packages/backend/src/http/` 模块里的 HTTP 服务。

`packages/backend/src/http/` 负责：

- 用 `Bun.serve()` 暴露最小 HTTP 服务。
- 提供 `POST /api/chat` SSE 接口，接收 `text`、可选 `agent`、可选 `sessionID`。
- 为每个请求订阅 runtime events，并把内部事件映射为前端友好的 SSE 帧。
- 当前事件格式对齐前端常见流式消费模式：`text-start`、`text-delta`、`reasoning-delta`、`tool-call`、`tool-result`、`finish`、`error`。
- 每个流式事件都同时携带 `messageID` 和 `turnID`：前者标识整次用户回复，后者标识该回复里的具体 assistant step。
- 保留 runtime 内部的 session tree 语义；root session 下的子 agent 事件也会继续透传到同一 SSE 流。
- 管理 `/openapi.json` 与 `/docs`，提供在线接口文档预览。

`frontend/` 负责：

- 提供一个独立最小 React 聊天页面项目。
- 通过浏览器端 `fetch` + SSE 解析消费 `POST /api/chat`。
- 每次用户提交只渲染一条 assistant 消息，再把该请求里的多个 turn 按时间顺序折叠进消息内部。
- 在 assistant 消息内部，用 `CoT` 区块承载 reasoning / tool / subagent 轨迹，用 `build answer` 区块承载正文，并按输出顺序交错展示。
- `CoT` 区块按 task / session 聚合，而不是按 turn 切块；若是 delegated task，标题优先使用 `task.description`。
- 仍保留 `messageID` / `turnID` 区分：前者用于标记一整次回复，后者用于标记消息内部的具体 step。
- 默认开发地址为 `http://localhost:5173`，默认后端地址为 `http://localhost:4444`，可通过 `VITE_API_BASE_URL` 覆盖。

## TUI 结构

`packages/tui/src/` 基于 `@opentui/solid` 实现，当前拆分为：

- `app.tsx`：TUI 启动、状态编排、runtime 事件订阅、快捷键协调。
- `components/`：sidebar、transcript item、composer、crash view 等视图组件。
- `trace.ts`：把 runtime 事件归并为可渲染 trace entry。
- `theme.ts`：颜色、展示常量和无副作用 UI/trace 辅助函数。
- `types.ts`：TUI 内部共享类型。

整体界面仍然分为：

- 左侧 sidebar：当前 agent、会话列表、快捷键提示。
- 右侧 transcript：按 session tree 扁平展示 user / thinking / tool / answer / error。
- 底部 composer：输入 prompt，支持取消、快速切换会话，以及通过 `@` 打开全文件候选列表并按当前 token 过滤；若选中的是图片路径，提交时会自动作为图片附件传给 harness，也可继续用 `ctrl+v` 附加剪贴板图片。

## 事件驱动渲染

`packages/harness/src/runtime/events.ts` 提供 runtime-scoped 事件总线工厂，CLI logger 与 TUI 都通过 `runtime.events` 订阅状态变化。

典型事件包括：

- session-start
- turn-start / turn-phase / turn-complete
- reasoning / text
- tool-call / tool-start / tool-metadata / tool-result / tool-error
- structured-output / compaction / error

## CLI 输出模式

`packages/harness/src/runtime/logger.ts` 提供两种模式：

- `stream`: 边收边打印 reasoning 与 answer。
- `buffered`: turn 完成后再成块输出。

logger 只关心展示，不负责 session 状态本身，状态仍由 `SessionStore` 维护。

## 修改建议

- 想改交互参数，优先看 `apps/cli/src/index.ts`。
- 想改终端布局、trace 折叠或快捷键，优先看 `packages/tui/src/app.tsx`。
- 想新增可视化事件，先扩展 `RuntimeEvent`，再同步更新 logger 与 TUI。

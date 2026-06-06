# 项目地图

## 目标

这是一个面向 OpenCode 核心行为的精简 TypeScript runtime，重点保留以下主线：

- prompt -> model -> tool execution -> session update -> next step
- 子 agent 委派与 child session 复入
- provider 适配与统一流式 chunk 协议
- session compaction 与 structured output 注入
- CLI/TUI 两种交互入口

## 顶层结构

```text
packages/
├── harness/                        # agent harness（引擎），跨包别名 @harness
│   └── src/
│       ├── agent/                  # agent 注册、默认 prompt
│       ├── llm/                    # 模型注册、provider 协议、Qwen/fake 适配
│       ├── plugin/                 # runtime plugin 契约与装配
│       ├── runtime/                # bootstrap、事件总线、控制台输出
│       ├── session/                # prompt loop、processor、store、compaction
│       ├── skill/                  # runtime skill registry
│       ├── tool/                   # 内置工具注册与执行
│       ├── module.ts               # core 插件定义
│       ├── config.ts               # 配置解析与校验
│       ├── types.ts                # 全局核心类型
│       └── index.ts                # 公共 API barrel（@harness 出口）
├── backend/                        # 薄 HTTP/SSE 传输层 + 领域功能，别名 @backend
│   └── src/
│       ├── http/                   # HTTP/SSE 模块与在线文档
│       ├── board/                  # board 专用 agent/tool/report 能力
│       ├── integrations/postgres/  # PostgreSQL 访问边界
│       ├── compose.ts              # 应用层插件组合根（corePlugin + boardPlugin）
│       └── server.ts               # SSE HTTP 启动入口
├── tui/                            # 交互式终端 UI（opentui/solid），别名 @tui
│   └── src/app.tsx
└── contracts/                      # 前后端共享 wire 类型（SSE StreamEvent），别名 @contracts
apps/
├── cli/
│   └── src/index.ts                # CLI 入口
└── frontend/                       # Vite + React Web 客户端（import @agent-loop/contracts）
```

## 主执行链路

1. `apps/cli/src/index.ts` 解析命令行参数，选择 CLI 或 TUI；`packages/backend/src/server.ts` 启动 `packages/backend/src/http/` 模块提供的 SSE HTTP 边界。
2. `packages/harness/src/runtime/context.ts` 通过 `packages/harness/src/config.ts` 解析配置，创建新的 runtime 实例及其 `session_store`、agent/tool/skill registry、event bus。
3. `packages/harness/src/runtime/bootstrap.ts` 装配 runtime plugins，注册 agents、tools、skills，并执行最小生命周期。
4. `packages/harness/src/session/prompt.ts` 创建 user message，进入外层 loop。
5. `packages/harness/src/session/processor.ts` 调用 `LLM.stream()` 消费 chunk，并把文本、reasoning、tool 调用写回 session。
6. tool 调用通过 `packages/harness/src/tool/*` 执行；`packages/harness/src/tool/tool.ts` 中的 harness 统一处理参数校验、hook、错误归一化和结果归一化；`task` 会创建 child session，`task_resume` 会复用已有 child session，并再次进入 `SessionPrompt.prompt()`。
7. 若模型返回 `length`，`packages/harness/src/session/compaction.ts` 会压缩上下文后继续下一轮。
8. runtime 实例上的 `events` 广播事件，由 `packages/harness/src/runtime/logger.ts` 或 `packages/tui/src/app.tsx` 订阅并渲染执行过程。

## 运行时插件装配

- `packages/harness/src/module.ts`: 核心插件，提供通用 agents 与 tools。
- `packages/backend/src/board/index.ts`: board 插件，提供 board 专用 agents 与 tools。
- `packages/backend/src/compose.ts`: 应用层选择要装配的插件集合。
- `packages/backend/src/board/skills/index.ts`: 通过 `RuntimePlugin.skills` 声明具体 skill 内容。
- `packages/harness/src/plugin/manager.ts`: 负责注册 plugin 的 `agents` / `tools` / `skills`，并执行可选 `setup` / `dispose` 生命周期。

## 推荐阅读路径

- 想理解主循环：先读 `docs/modules/runtime-and-session.md`
- 想理解模型调用：先读 `docs/modules/llm-and-providers.md`
- 想理解 agent/tool 编排：先读 `docs/modules/agents-and-tools.md`
- 想理解 board 报告链路：先读 `docs/modules/board-and-integrations.md`
- 想理解 CLI/TUI 入口：先读 `docs/modules/entrypoints-and-ui.md`

## 关键扩展点

- 新增 agent: `packages/harness/src/agent/*` 或模块私有 `agents.ts`
- 新增 tool: `packages/harness/src/tool/*` 或模块私有 `tools.ts`
- 新增 runtime plugin: 新建插件对象后注册到 `packages/backend/src/compose.ts`
- 新增 provider: 放在 `packages/harness/src/llm/providers/`，并接入 `packages/harness/src/llm/models.ts`
- 新增结构化输出场景: 复用 `SessionPrompt` 中的 `StructuredOutput` 注入机制

## 初始化约束

- `packages/harness/src/config.ts` 只做配置解析和校验，不承担运行时对象初始化。
- `packages/harness/src/runtime/context.ts` 是运行时依赖的唯一组合根。
- `packages/harness/src/session/store/` 只提供接口、实现和工厂；不要在 store 模块内部维护新的启动型单例。
- 新的跨模块运行时依赖应优先挂到 `RuntimeContext`，避免继续扩散隐式全局状态。

# 项目地图

## 目标

一个面向 OpenCode 核心行为的精简 TypeScript runtime，保留这几条主线：

- 主循环：user message → model → tool 执行 → session 写回 → 下一步
- 子 agent 委派与 child session 递归
- provider 适配与统一流式 chunk 协议
- 上下文 compaction 与 structured output 注入
- CLI / TUI / SSE 三种交互入口

## 顶层结构

```text
packages/
├── harness/                  # agent harness（引擎），别名 @harness
│   └── src/
│       ├── core/             # 编排引擎：loop、turn、context、policy、retry、stream-sink、tool-call、outcome
│       ├── hooks/            # middleware 契约与执行栈（生命周期 hook）
│       ├── middleware/       # 内置中间件：compaction、budget、doom-loop、structured-output、view-image 等
│       ├── agent/            # agent 模块：lead/、general/、shared/、registry、types
│       ├── llm/              # Model 抽象 + providers（openai-compat 底座、dashscope）
│       ├── tool/             # defineTool harness + 内置工具
│       ├── session/          # 状态持久化：store/、tool-part（稳定 ToolPart 协议）
│       ├── runtime/          # bootstrap、context、events、logger、trace
│       ├── skill/、plugin/   # runtime skill registry；plugin 契约与装配
│       ├── module.ts         # corePlugin（通用 agents + tools）
│       ├── config.ts         # 引擎行为配置解析与校验
│       ├── types.ts          # 全局核心类型
│       └── index.ts          # 公共 API barrel（@harness 出口）
├── backend/                  # 薄 HTTP/SSE 传输 + board 领域插件，别名 @backend
│   └── src/{http,board,compose.ts,server.ts}
├── tui/                      # 交互式终端 UI（opentui/solid），别名 @tui
└── contracts/                # 前后端共享 wire 类型（SSE StreamEvent），别名 @contracts
apps/
├── cli/src/index.ts          # CLI 入口
└── frontend/                 # Vite + React Web 客户端（import @agent-loop/contracts）
```

## 主执行链路

1. `apps/cli/src/index.ts` 解析参数，选择 CLI 或 TUI；`runPrompt()`（`@harness` 出口）发起一次 session。
2. `runtime/context.ts` 通过 `config.ts` 解析配置，组装 `RuntimeContext`（session_store、registries、events）。
3. `runtime/bootstrap.ts` 装配 runtime plugins，注册 agents / tools / skills。
4. `core/loop.ts` 的 `runSession` 追加 user message，进入 `runLoop`。
5. 每一步（一个 turn）按生命周期推进：
   `beforeTurn` → `contributeSystem` → `transformMessages` → `runTurn`（stream + 工具派发 + `onTurnFinish`）→ `resolveOutcome`。
6. `core/turn.ts` 调用 `ctx.model.stream()`（带 retry），把 text/reasoning/tool-call 写回 session。
7. 工具经 `tool/tool.ts` 的 `defineTool` 统一校验/执行/归一化；`task` 创建 child session 并递归回 `runSession`。
8. middleware 塑形结果：compaction 在 `beforeTurn` 压缩超长上下文，budget/doom-loop 等收口 outcome。
9. `runtime/events` 广播事件，由 `runtime/logger.ts`（CLI）或 `tui/app.tsx`（TUI）订阅渲染。

> 主链路的完整生命周期注释以 `core/loop.ts` 顶部为准。

## 运行时插件装配

- `module.ts`：`corePlugin`，提供通用 agents（lead、general）与 core tools。
- `backend/src/board/index.ts`：`boardModule`，提供 board 专用 agents / tools / skill。
- `backend/src/compose.ts`：应用层选择要装配的插件集合（corePlugin + boardModule）。
- `plugin/manager.ts`：注册插件的 `agents` / `tools` / `skills`，并跑可选 `setup` / `dispose`。

## 扩展点

- **新 agent**：在 `agent/` 下新建模块（prompt + middleware + 绑定 model），加入 `coreAgents`，或由插件提供。
- **新 tool**：`defineTool()` 定义后注册到 `tool/tools.ts`（或模块私有 tools），并为合适的 agent 开启。
- **新 middleware**：实现 `hooks/types.ts` 的 `Middleware`，加入 agent 的 middleware 组合。
- **新 provider**：在 `llm/providers/` 新建 `create<Vendor>Model`，自带 `ConnectionSchema`；走 OpenAI 兼容端点就建在 `createOpenAICompatModel` 之上。
- **新业务插件**：仿照 board 定义独立 `index.ts` 导出 `RuntimePlugin`，注册到 `compose.ts`。

## 初始化约束

- `config.ts` 只做配置解析与校验，不创建运行时对象。
- `runtime/context.ts` 是运行时依赖的唯一组合根。
- `session/store/` 只提供接口、实现与工厂；不在其中维护启动型单例。
- 新的跨模块运行时依赖优先挂到 `RuntimeContext`，避免扩散隐式全局状态。

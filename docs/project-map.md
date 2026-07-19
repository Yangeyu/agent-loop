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
│       ├── agent/            # ★ 原子内核（聚合）：blueprint(defineAgent)、create-agent(原子工厂)、hooks(5-hook 契约+执行栈)、loop、turn、recorder、context(EngineDeps)、policy、retry、tool-call、tool-part、outcome、registry
│       ├── session/          # 状态基座：Sessions 聚合（唯一写入者）+ SessionPersistence（memory/file）
│       ├── event/            # 双通道总线（叶子基础设施，session 与内核共用）
│       ├── llm/              # Model 抽象 + providers（openai-compat 底座、dashscope）
│       ├── tool/             # 工具契约：defineTool + registry
│       ├── skill/            # skill 契约 + registry
│       ├── std/              # ★ 标准积木层：middleware/（compaction、budget、doom-loop…）、agents/（lead、general、shared）、tools/（createCoreTools 及内置工具）
│       ├── runtime/          # 组合层：bootstrap（createRuntime/runPrompt）、context
│       ├── config.ts         # 引擎行为配置解析与校验
│       ├── types.ts          # 全局核心类型
│       └── index.ts          # 公共 API barrel（@harness 出口）
├── backend/                  # 薄 HTTP/SSE 传输 + board 领域模块，别名 @backend
│   └── src/{http,board,compose.ts,server.ts}
├── tui/                      # 交互式终端 UI（opentui/solid），别名 @tui
└── contracts/                # 全链路共享词汇：数据模型 + StateEvent/LoopEvent + reducer，别名 @contracts
apps/
├── cli/src/index.ts          # CLI 入口
└── frontend/                 # Vite + React Web 客户端（import @agent-loop/contracts）
```

## 主执行链路

1. `apps/cli/src/index.ts` 解析参数，选择 CLI 或 TUI；`runPrompt()`（`@harness` 出口）发起一次 session。
2. `backend/src/compose.ts`（组合根）构建模型实例，调用 agent/tool 工厂，`createRuntime` 收扁平列表注册。
3. `runtime/context.ts` 通过 `config.ts` 解析配置，组装 `RuntimeContext`（= 内核的 `EngineDeps`）。
4. `agent/loop.ts` 的 `runSession` 追加 user message，进入 `runLoop`。
5. 每一步（一个 turn）按生命周期推进：
   `beforeTurn` → `assembleContext`（引擎种入 instructions）→ `runTurn`（stream + 工具派发）→ `judgeTurn`（终态 + 去留一次裁决）。
6. `agent/turn.ts` 调用 `ctx.model.stream()`（带 retry），经 `TurnRecorder` 把 text/reasoning/tool-call 写进 Sessions（状态事件随写入自动发出）。
7. 工具经 `tool/tool.ts` 的 `defineTool` 统一校验/执行/归一化；`task` 创建 child session 并递归回 `runSession`。
8. middleware 塑形结果：compaction 在 `beforeTurn` 压缩超长上下文，budget/structured-output 在 `judgeTurn` 收口。
9. `event/bus.ts` 分 state/loop 两通道广播，由 `apps/cli/src/logger.ts`（CLI）或 `tui/app.tsx`（TUI）订阅渲染。

> 主链路的完整生命周期注释以 `agent/loop.ts` 顶部为准。

## 组合即代码

- `std/agents/index.ts`：`createCoreAgents({ model, summarizer })`（lead、general）。
- `std/tools/index.ts`：`createCoreTools({ visionModel })`。
- `backend/src/board/index.ts`：`createBoardAgents({ model })` + `boardTools` + `boardSkills`。
- `backend/src/compose.ts`：唯一的 provider 绑定点；展开上述工厂结果传给 `createRuntime`。
- `agent/create-agent.ts`：`createAgent(spec)` 独立原子入口（自带内存会话的单 agent 运行单元，内核直接导出）。

## 扩展点

- **新 agent**：在 `std/agents/` 下新建原子模块（工厂：prompt + middleware，模型经参数注入），加入组合根的装配列表。
- **新 tool**：`defineTool()` 定义后加入 `createCoreTools`（或消费方工具列表），并为合适的 agent 开启。
- **新 middleware**：实现 `agent/hooks.ts` 的 `Middleware`（5 个 hook），加入 agent 的 middleware 组合。
- **新 provider**：在 `llm/providers/` 新建 `create<Vendor>Model`，自带 `ConnectionSchema`；走 OpenAI 兼容端点就建在 `createOpenAICompatModel` 之上。
- **新业务模块**：仿照 board 导出 agent 工厂 + tools + skills，在 `compose.ts` 展开组合。

## 初始化约束

- `config.ts` 只做配置解析与校验，不创建运行时对象。
- `runtime/context.ts` 是运行时依赖的唯一组合根。
- `session/` 中 `Sessions` 是状态唯一写入者；持久化后端只实现 read/persist/list 三方法，不维护启动型单例。
- 新的跨模块运行时依赖优先挂到 `RuntimeContext`，避免扩散隐式全局状态。

# CLI

> 范围：`apps/cli`——命令行入口。

## 职责

把命令行输入接入 harness：解析参数、装配 runtime、发起一次 session，并把过程渲染到终端。
无 prompt 且在交互终端时默认进 TUI。

## 关键入口

- `@apps/cli/src/index.ts` — 唯一入口：参数解析 + `createRuntime()` + `runPrompt()`。
- `@apps/cli/src/logger.ts` — 终端渲染，两种输出模式（`stream` / `buffered`）；渲染是表面层
  关注点，住在 CLI 自己包里，只经 `@harness` barrel 消费事件类型。

## 数据流

- 解析 `--agent / --session / --json / --tui / --output`。
- `createAppRuntime()`（`src/compose.ts`，唯一的 provider 绑定点）装配运行时
  （测试/smoke 用 `createAppTestRuntime()`，默认 memory store）。
- `runPrompt()` 跑一次完整 session；`attachConsoleLogger` 订阅 `runtime.events` 渲染。
- `--output stream` 边收边打 reasoning/answer；`buffered` turn 完成后成块输出。

## 扩展点

- 改交互参数：都在 `apps/cli/src/index.ts`。
- 新输出模式：扩展 `apps/cli/src/logger.ts`。

## 约束与经验

- CLI 只解析输入、渲染事件，**不持有/修改 session 状态**；渲染走事件订阅，不反查内部对象。

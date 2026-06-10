# TUI

> 范围：`packages/tui`——基于 `@opentui/solid` 的交互式终端 UI。

## 职责

把 harness 的运行过程渲染成一个分栏终端体验：编排状态、订阅 runtime 事件、协调快捷键。
只做展示，session 状态归 harness。

## 关键入口

- `@tui/src/app.tsx` — TUI 启动、状态编排、runtime 事件订阅、快捷键协调。
- `@tui/src/components/` — 视图组件：`transcript`、`composer`、`crash-view`。
- `@tui/src/trace.ts` — 把 runtime 事件归并为可渲染 trace entry。
- `@tui/src/theme.ts` / `types.ts` — 展示常量、无副作用辅助、内部共享类型。

## 数据流

- 订阅 `runtime.events`，把事件归并成 transcript 条目渲染。
- 界面两区：上 transcript（按 session tree 扁平展示 user/thinking/tool/answer/error），
  底 composer（输入、取消）。`ctrl+n` 新建会话，`tab` 切换 agent；无可视会话列表故不提供会话间切换。
- composer 支持 `@` 打开全文件候选并按 token 过滤（选图片路径则提交时作为图片附件），`ctrl+v` 贴剪贴板图片。

## 扩展点

- 改终端布局/快捷键/trace 折叠：`app.tsx` 与 `components/`。
- 新可视化事件：先扩展 `RuntimeEvent`，再在 `trace.ts` / 组件里消费。

## 约束与经验

- TUI 只渲染事件，**不持有/修改 session 状态**；新增展示需求优先扩展 runtime 事件，保持单向。

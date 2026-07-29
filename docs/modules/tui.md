# TUI

> 范围：`packages/tui`——基于 `@opentui/solid` 的交互式终端 UI。

## 职责

把 harness 的运行过程渲染成一个分栏终端体验：编排状态、订阅 runtime 事件、协调快捷键。
只做展示，session 状态归 harness。

## 关键入口

- `@tui/src/app.tsx` — TUI 启动、状态编排、runtime 事件订阅、快捷键协调。
- `@tui/src/components/` — 视图组件：`transcript`、`composer`、`crash-view`。
- `@tui/src/trace.ts` — `createTraceFolder`：把 state/loop 两个通道折叠为可渲染 trace entry，自包含（partID 为 join key，不读 store）。
- `@tui/src/theme.ts` / `types.ts` — 展示常量、无副作用辅助、内部共享类型。

## 数据流

- 订阅 `runtime.events.state`（内容）与 `runtime.events.loop`（遥测）：内容条目由 trace folder
  按 partID 折叠，活动状态（spinner/phase）来自 loop 的 `step.start/phase/end`。
- 条目自带 `rootID`/`sessionChain`/`topLevel`，会话树过滤与「折叠某个子 agent 分支」都是一次比较，
  不爬 parentID 链。
- **trace 不认识任何具体工具**：一次工具调用的措辞来自工具自己声明的 `ToolDisplay`
  （`verb`/`target`/`summary`）。在这里为某个工具加分支，等于把工具已经说过的事
  重新猜一遍，工具改个参数名就会漂移。
- **一次调用一行，不做合并**。曾经有过按 `mergeKey` 折叠连续同键调用的机制，随 `append` 工具
  一起删掉了：文件工具现在每次只动一个地方（`write` 整体替换、`edit` 改一处），两次调用就是两件事，
  合并只能显示其中一个状态和一条 summary，等于悄悄丢掉另一个。
- 界面两区：上 transcript，底 composer（输入、取消）。`ctrl+n` 新建会话，`tab` 切换 agent；
  无可视会话列表故不提供会话间切换。
- composer 支持 `@` 打开全文件候选并按 token 过滤（选图片路径则提交时作为图片附件），`ctrl+v` 贴剪贴板图片。

## 扩展点

- 改终端布局/快捷键/trace 折叠：`app.tsx` 与 `components/`。
- 新可视化事实：先扩展 `@agent-core` 的 `StateEvent`/`LoopEvent`（及发射端），再在 `trace.ts` / 组件里消费。

## 展示分层

transcript 按视觉权重分三层，这是它唯一的布局规则：

| 层 | 内容 | 形态 |
| --- | --- | --- |
| 对话 | user prompt、顶层 answer | 全宽、无前缀、正文色——用户真正要读的东西 |
| 过程 | tool 调用、thinking | **严格一行**、暗色、状态字形起头 |
| 细节 | 完整 input/output | 仅在展开时出现 |

- **颜色编码的是注意力，不是类别**：完成的调用用暗灰，因为成功是常态；把它涂绿会让真正需要
  眼睛的失败失去对比。
- **排版属于 surface**：工具给出完整的 `target`，只有视图知道还剩几列，`fitText` 中间省略
  （`packages/…/loop.ts` 仍能认出文件，尾部截断则认不出）。
- 深度画成缩进而不是每行重复 `lead > general > read` 的前缀——那会把省下来的宽度又花掉。
  子 agent 的 user 行是该分支的折叠头，收起后一个跑完的子 agent 只占一行。

## 约束与经验

- TUI 只渲染事件，**不持有/修改 session 状态**；新增展示需求优先扩展 runtime 事件，保持单向。
- 展示所需的新事实，先问「这是工具知道的还是视图知道的」：工具知道它操作了什么、结果如何
  （进 `ToolDisplay`）；视图知道视口多宽、什么该抢眼（留在 TUI）。

# 开发规范与设计原则

`AGENTS.md` 列出的是不可妥协的核心约束；本文给出完整规范，以及随项目沉淀下来的
设计原则。原则部分都写成正向规则——它们是踩过坑后的结论，不是变更记录。

## 架构分层

引擎按三层组织，职责正交：

- **agent（原子内核）**：`agent/loop.ts` 驱动 turn 循环，`agent/turn.ts` 跑单轮。**agent-agnostic**——
  引擎不认识任何具体 agent，不按 agent 身份分支。行为通过 middleware 与工具注入。
- **agent（模块）**：一个 agent 是“能力（prompt + tools + middleware）+ 绑定的 `model` 实例”。
  每个 agent 是一个自包含模块（`std/agents/lead/`、`std/agents/general/`），不是一张配置表。
- **middleware（中间件）**：transform/decision 层。按 `agent/hooks.ts` 的生命周期介入——
  改写上下文、门控工具、塑形 turn 结果。它与只读的事件总线（`runtime/events.ts`）是两回事。

> **原则：行为靠组合，不靠分支。** 想让引擎做新事，加一段 middleware 或一个工具，
> 而不是在 core 里加 `if (agent === ...)`。

## 依赖与边界

- **跨包方向单向**：`contracts ← harness ← surfaces`（cli/tui）。contracts 是纯叶子
  （数据模型 + 事件词汇，零依赖）；harness 不反向依赖 surface。
  由 `bun run check:boundaries` 强制。
- **RuntimeContext vs RuntimeDeps**：`RuntimeContext` 是完整运行时，只由组合根（bootstrap、
  CLI/TUI 入口）持有；执行链拿到的是依赖切片 `RuntimeDeps`（config / registries / sessions /
  events）。能拿 `RuntimeDeps` 的地方就不要持有 `RuntimeContext`。
- **显式注入，拒绝隐式全局**：registry、store、event bus 都属于某个 runtime 实例。

> **原则：新的运行时依赖挂到 `RuntimeContext`，不要新增模块级单例或 `getX()` 反查。**
> 唯一允许的模块级缓存是无状态、可重建的惰性单例（如 provider client），且不得捕获可变配置。

## 类型与不可信输入

- 用显式类型和可辨识联合（discriminated union）建模核心运行时数据。
- 把 provider 响应、工具参数、外部 JSON 都当不可信输入：**先解析成类型化结构，
  再进入核心循环**。优先 `unknown` + 收窄，避免 `any`。

> **原则：未知输入要 fail fast，不要静默兜底。** 比如未知的 model id 直接抛错，
> 而不是悄悄回退到默认——否则你以为在跑 A，其实在跑 B。

## 声明式默认值

配置默认值用 schema 的 `.default()` 声明，集中在一处；不要在调用点写 `?? DEFAULT` 散落兜底。
引擎行为配置在 `config.ts`；厂商连接配置归 provider 自己（见 llm 模块）。

> **原则：默认值有唯一声明处。** 读代码的人在 schema 上就能看全所有默认，不必追散落的 `??`。

## 模块自包含

一个组件需要的东西尽量在自己内部解决，不外溢到上层去配。

- middleware 的逻辑、复用范式、辅助资源自包含。例如 compaction 在模块内建自己的廉价摘要
  模型，单次调用，从不走主循环。
- provider 自带 createModel、模型目录、连接配置；接新厂商是线性扩展，不污染引擎。

> **原则：把决策放在离它最近、最内聚的地方。** 自包含换来的是“加东西不需要改别处”。

## 工具

- 一个工具的 schema、描述、执行逻辑放在一起。
- 横切逻辑（参数校验、错误归一化、metadata、output 截断）走 `defineTool()` 的 hook 与
  归一化阶段，不要散落进每个 `execute()`。
- 工具结果若要在后续轮次被模型感知，必须写回 session part。
- 新工具注册到对应模块的 tools 汇总（core 走 `std/tools/index.ts`），并为合适的 agent 开启。

## 代码风格

- 无分号、双引号、2 空格缩进。
- 类型导入用 `import type`；TS 源码 import 不加 `.js` 后缀。
- 别名导入：`@harness/*`、`@tui/*`、`@contracts`；不重新引入 `@/`。
- **注释**：导出 API 用 JSDoc（讲契约：参数、返回、用途）；内部实现用 `//`（讲“为什么”，不复述代码）。
- 优先短函数和清晰的模块边界；只在确实提升可读性/复用/隔离时才引入抽象。

## 测试

- harness 测试集中在 `packages/harness/tests/`，按源码模块分区（`tests/llm/`、`tests/middleware/`、
  `tests/tool/` 等），不散落在 `src/` 下。
- 不依赖网络：用 `tests/support/fake-model.ts` 的 `createFakeModel` 构造 stub `Model`；
  需要注入辅助模型的 middleware（如 compaction）通过工厂参数注入 fake。
- 根目录跑 `bun run test:harness`，或包内 `bun run test`。

## 验证基线

提交前过一遍：`bun run check`（逐包 tsc）、`bun run check:boundaries`（依赖方向）、
`bun run test:harness`、必要时 `bun run build`。

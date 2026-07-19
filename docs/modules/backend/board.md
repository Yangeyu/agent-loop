# Board 与集成

> 范围：`packages/backend` 的 `board/` 领域插件与 `integrations/postgres`。传输层见 `http-and-sse.md`。

## 职责

一个垂直业务示例：把 board 数据从 PostgreSQL 抽取、归一化，再交给业务 agent 通过 delegation
loop 自主组织分析与写作。它示范了“业务能力作为内聚模块接入组合根”，而不写死进 core。

## 关键入口

- `@backend/src/board/index.ts` — 导出 `createBoardAgents({ model })` / `boardTools` / `boardSkills`；
  分组由模块自身表达（一个 index），runtime 没有 plugin 概念，`compose.ts` 展开这些列表。
- `@backend/src/board/agents/` — board subagents：`board_analysis_prepare`、`board_bundle_analyze`、`board_write`。
- `@backend/src/board/tools/` — board 原语工具（snapshot、analysis context/bundle-read、asset upsert/read、report-write）。
- `@backend/src/board/skills/` — `board-analysis` workflow skill。
- `@backend/src/board/shared/` — `snapshot`（DB→上下文）、`analyze`（清洗+聚合）、`store`（dataset 持久化）、`report-store`（落盘）。
- `@backend/src/integrations/postgres/client.ts` — 只读 Postgres 访问边界。

## 数据流

典型 agentic loop（由 `lead` 通过通用 skill + agent/tool 编排，而非 core 写死）：

1. `lead` 用 `skill` 工具加载 `board-analysis` skill。
2. 委派 `board_analysis_prepare`：调 `board_analysis_context` 创建已存储的 dataset，只回 `analysisId`、
   overview、aggregates、cleaning logs 与可用 bundle 目录；完整 dataset 落到 `data/board-analysis-store/<id>.json`。
3. `lead` 按 skill 指南选 bundle，用 `task` 委派 `board_bundle_analyze`（同一 turn 发起多个 `task` 时由引擎并发执行）。
4. 每个 `board_bundle_analyze` 只读一个 bundle，把高价值内容经 `board_analysis_asset_upsert` 写回 dataset store。
5. `lead` 委派 `board_write` 读取已存资产、生成报告，写入项目数据目录，**只把 markdown 文件路径返回主对话**。

数据归一化边界：`shared/snapshot.ts` 把 DB 原始 nodes/edges 归一化为 `BoardItem[]`/`BoardLink[]` 并算 metadata；
`shared/analyze.ts` 清洗无效/重复节点、构建 article corpus、聚合研究 bundle 存入 dataset store。
Postgres 边界在 `BEGIN READ ONLY` 事务里执行查询，设 statement timeout 并保证异常回滚。

## 扩展点

- 新业务模块仿照 board：独立 `index.ts` 导出 agent 工厂 + tools + skills，在 `compose.ts` 展开组合。
- 新 DB 查询保持在 integration + snapshot 层，不把 SQL 暴露进 agent/tool prompt。

## 约束与经验

- **业务流程靠 skill + agent/tool 编排**，不写进 runtime/core——board 是“可插拔垂直能力”的范本。
- **大体量数据走 dataset store，不灌主对话**：context/prepare 只回摘要与目录，正文按需读取，
  最终报告只回文件路径（避免把全文塞回 session 文本）。
- DB 访问只读、有超时、异常回滚，集中在 `integrations/postgres`。

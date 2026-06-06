# Board 与集成模块说明

## 模块职责

这一层提供一个垂直业务示例：把 board 数据从 PostgreSQL 抽取、归一化，再交给业务 agent 通过 delegation loop 自主组织分析与写作。

## 相关文件

- `packages/backend/src/board/index.ts`
- `packages/backend/src/board/agents.ts`
- `packages/backend/src/board/tools.ts`
- `packages/backend/src/board/store.ts`
- `packages/backend/src/board/snapshot.ts`
- `packages/backend/src/board/analyze.ts`
- `packages/backend/src/board/types.ts`
- `packages/backend/src/board/skills.ts`
- `packages/backend/src/board/skills/board-analysis.md`
- `packages/backend/src/board/prompts/index.ts`
- `packages/backend/src/integrations/postgres/client.ts`

## 模块装配

`packages/backend/src/board/index.ts` 导出 `boardModule`，向 runtime 注册：

- `board-analysis` skill
- `board_analysis_prepare` subagent
- `board_bundle_analyze` subagent
- `board_write` subagent
- `board_snapshot` tool
- `board_analysis_context` tool
- `board_analysis_bundle_read` tool
- `board_analysis_asset_upsert` tool
- `board_analysis_asset_read` tool
- `board_report_write` tool

这说明 board 能力不是写死在 core 中，而是通过 runtime module 注册为一个面向 `build` 的 workflow skill，加一组 board subagents 和 board 原语 tools。

## Board Agentic Loop

典型流程如下：

1. `build` 通过 `skill` tool 加载 `board-analysis` skill。
2. `build` 通过 `task` 委派 `board_analysis_prepare` 创建一个已存储的 board analysis dataset。
3. `board_analysis_prepare` 调用 `board_analysis_context`，只返回 `analysisId`、overview、board aggregates、cleaning logs 和可用 bundle 目录，不把全量聚合正文直接塞给主对话。
   同时完整 dataset 会持久化到 `data/board-analysis-store/<analysisId>.json`。
4. `build` 根据 skill 指南选择需要分析的 bundle，并通过 `task` 把每个 bundle 委派给 `board_bundle_analyze`。
5. 当多个 bundle 彼此独立时，`build` 可以通过 `batch` 并行发起多个 bundle 子任务。
6. 每个 `board_bundle_analyze` 只读取一个 bundle，并通过 `board_analysis_asset_upsert` 把高价值内容写回 dataset store。
7. `build` 再通过 `task` 委派 `board_write`，由它读取已存储资产、生成最终报告并写入当前项目的数据目录。
8. `board_write` 只把 markdown 文件路径返回给主对话，不把整篇报告正文塞回 session 文本。
9. 这一链路依赖通用 skill + agent/tool 编排，而不是在 runtime/core 中写死业务流程。

## 数据归一化

`packages/backend/src/board/snapshot.ts` 负责：

- 查询 board 主信息和最新 board_data
- 把 `nodes` 归一化为 `BoardItem[]`
- 把 `edges` 归一化为 `BoardLink[]`
- 计算 metadata，如 item/link 数量与类型计数

`packages/backend/src/board/analyze.ts` 负责：

- 清洗无效、重复、空文本节点
- 清理失效引用
- 基于 section 的空间边界构建 article corpus
- 聚合研究 bundle，并存入 dataset store 供 `build` 和 board subagents 按需读取

它们的定位是“数据库原始结构 -> runtime 可消费上下文”的转换边界。

`packages/backend/src/board/store.ts` 负责：

- 保存 board analysis dataset
- 将 dataset 持久化为 `data/board-analysis-store/*.json`
- 生成 dataset summary
- 按 `analysisId + bundleType` 读取 bundle 数据
- 按 `analysisId` 保存和读取中间 analysis assets

`packages/backend/src/board/shared/report-store.ts` 负责：

- 将最终 board 报告写入当前项目的数据目录
- 返回报告文件路径和基础元数据

## Postgres 边界

`packages/backend/src/integrations/postgres/client.ts` 封装只读查询：

- 读取 `KIWOO_DATABASE_URL`
- 维护共享连接池
- 在 `BEGIN READ ONLY` 事务中执行查询
- 设置 statement timeout 并确保异常时回滚

## 扩展建议

- 新业务模块可以仿照 board：独立定义 `index.ts`、`agents.ts`、`tools.ts`、`types.ts` 和自己的 prompt 集合。
- 若新增数据库查询，尽量保持在 integration 和 snapshot 层，不把 SQL 暴露到 agent/tool prompt 中。

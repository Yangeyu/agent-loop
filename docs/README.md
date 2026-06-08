# 项目文档

这套文档给开发者和编码 agent 提供稳定的项目地图，减少重复扫读源码的成本。
入口是仓库根目录的 `AGENTS.md`——它承载核心约束与文档路由；本目录承载完整的
规范、地图与模块说明。

## 文档树

`docs/modules/` 按 **package** 组织：每个 package 是路由键。harness 是引擎主体，内部按子架构
拆多篇；只装一篇文档的 package 直接用扁平文件，不建空目录。

```text
AGENTS.md              # 入口：核心约束 + 文档地图 + 同步纪律
docs/
├── README.md          # 本文件：文档体系说明与写作规范
├── conventions.md     # 工程开发规范 + 沉淀下来的设计原则
├── project-map.md     # 整体结构、主执行链路、扩展点
└── modules/
    ├── harness/                 # 引擎（packages/harness）
    │   ├── core-and-runtime.md  # 主循环、turn 生命周期、middleware、session 状态
    │   ├── llm-and-providers.md # Model 抽象、provider、流式协议
    │   └── agents-and-tools.md  # agent 模块、agent middleware、工具、委派
    ├── backend/                 # packages/backend
    │   ├── http-and-sse.md      # HTTP/SSE 传输、compose 装配
    │   └── board.md             # board 报告领域 + PostgreSQL 集成
    ├── contracts.md             # packages/contracts：共享 wire/SSE 协议
    ├── tui.md                   # packages/tui
    ├── cli.md                   # apps/cli
    └── frontend.md              # apps/frontend
```

## 阅读顺序

1. 先读 `project-map.md`，建立模块边界与主执行链路的整体认知。
2. 再按任务范围进入对应的 `modules/*.md`（路由表见 `AGENTS.md`）。
3. 写代码前回到源码确认细节——文档讲“职责与数据流”，不替代源码。

## 写作规范

文档的价值在于**稳定**。请遵循四条原则：

- **克制**：只写职责、关键入口、数据流、扩展点和必须遵守的约束。不抄源码，不列每一步。
- **正向**：描述系统现在“应当如何”，而不是“曾经怎样、后来改成怎样”。
- **经验性**：把踩过的坑沉淀成一条正向原则（写进 `conventions.md`），而不是记成流水账。
- **规范化**：模块文档统一走下面的模板，便于扫读和对照。

判断标准：一段话如果只有读过提交历史的人才看得懂，它就不该进文档。

## 模块文档模板

每份 `modules/*.md` 固定五段，缺省段可省略但不调换顺序：

```text
# <模块名>

## 职责        —— 这一层负责什么、不负责什么，一两句话。
## 关键入口    —— 真正的入口文件/函数（带 @harness/... 路径），不堆全量文件清单。
## 数据流      —— 输入如何流经本模块、产出什么，按链路而非按文件叙述。
## 扩展点      —— 想加东西时从哪里下手。
## 约束与经验  —— 必须遵守的边界，以及为什么（指向 conventions.md 的对应原则）。
```

## 同步纪律

- 改动模块职责、运行时流程或用户可见命令时，**在同一次改动里**更新对应文档。
- 文档过时（引用已迁移的文件/符号）等同于 bug，发现即修。
- 新沉淀的经验写进 `conventions.md`，不要散落到各模块文档里。

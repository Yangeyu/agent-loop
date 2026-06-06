# Monorepo 迁移方案

> 目标：把当前单包结构重构为基于 monorepo 的多模块架构，模块边界清晰、依赖单向、可独立测试与发布。
> 决策基线（已与负责人对齐）：
> - **board(报告) + postgres 并入 backend**
> - **backend 定位为薄传输层**：只把 harness 能力经 HTTP/SSE 暴露 + 鉴权/路由，业务逻辑下沉到 harness 或 domain plugin
> - 本文档为**迁移前对齐稿**，确认后再动手

---

## 1. 术语对齐：harness

业界 **agent harness / harness engineering** = 包裹 LLM 推理循环的**非模型运行时基础设施**：工具调度、上下文管理、状态持久化、多 agent 编排、安全护栏。LLM 提供推理，harness 让它在真实场景可靠工作（常被类比为 "LLM 时代的 OS / control plane"）。

对照现有代码，`src/core/` 正是 harness 本体，因此重命名为 `harness` 比 `core` 更精确。

参考：
- [The Anatomy of an Agent Harness — LangChain](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness)
- [Agentic Harness Engineering: LLMs as the New OS — decodingAI](https://www.decodingai.com/p/agentic-harness-engineering)
- [The Agent Harness: Why the LLM Is the Smallest Part of Your Agent System — MongoDB](https://medium.com/@MongoDB/the-agent-harness-why-the-llm-is-the-smallest-part-of-your-agent-system-bce68414ccfd)
- [awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering)

---

## 2. 分层模型：4 个模块不是平级

`frontend / tui / backend` 是**消费方（surface / 入口）**，`harness` 是**被消费的引擎**。真实依赖方向：

```
surfaces:   frontend        tui        backend(http/sse)
                │            │              │
                │ HTTP/SSE   │ import       │ import
                └────────────┴──────────────┴──────► harness (engine)

铁律：surface → harness 单向；harness 绝不反向依赖任何 surface
      frontend 跑在浏览器，禁止 import harness，只能经 HTTP/SSE 调 backend
```

**组合根（composition root）洞察**：当前 `src/app/`（`appPlugins = [corePlugin, boardPlugin]`）负责"挑选并拼装"引擎 + 领域 plugin。在 monorepo 里，组合根属于**入口层**（cli / backend），不属于 harness。harness 只暴露 `createRuntime({ plugins })`，由谁来组合由入口决定。

---

## 3. 目标布局

```
agent-loop/
├── package.json                 # workspaces 根 + 公共脚本
├── bunfig.toml
├── tsconfig.base.json           # 公共 compilerOptions + path alias
├── packages/
│   ├── harness/                 # ← 现 src/core   引擎（零 surface 依赖）
│   │   ├── src/{llm,session,agent,tool,skill,plugin,runtime,...}
│   │   ├── package.json         # name: @agent-loop/harness
│   │   └── tsconfig.json
│   ├── backend/                 # ← 现 src/http + src/server.ts + src/board + src/integrations
│   │   ├── src/
│   │   │   ├── http/            # 传输层：chat/responses/openapi/files/server
│   │   │   ├── board/           # 领域 plugin（报告生成）
│   │   │   ├── integrations/    # postgres client
│   │   │   └── compose.ts       # 组合根：corePlugin + boardPlugin
│   │   └── package.json         # name: @agent-loop/backend
│   ├── tui/                     # ← 现 src/tui + index.ts 的 --tui 分支
│   │   └── package.json         # name: @agent-loop/tui
│   └── contracts/               # ← 新增：HTTP/SSE 请求响应类型，前后端共用
│       └── package.json         # name: @agent-loop/contracts
└── apps/
    ├── cli/                     # ← 现 src/index.ts（薄入口：解析 argv → harness/tui）
    └── frontend/                # ← 现 frontend/（Vite + Solid，浏览器）
```

> 命名空间用 `@agent-loop/*`（可按需改）。`apps/` 放可运行终端产物，`packages/` 放被复用的库。

---

## 4. 模块 → 包映射 & 当前依赖现状

基于实际 import 统计：

| 现路径 | 目标包 | 内部依赖（实测） |
| --- | --- | --- |
| `src/core/*` (191 引用) | `packages/harness` | 引擎本体，**不依赖** board/tui/http/app（叶子节点） |
| `src/board/*` (32 引用) | `packages/backend/src/board` | → harness(`core/types`,`tool`,`plugin/types`,`skill/types`,`session/store/types`) + `integrations/postgres` |
| `src/integrations/postgres` | `packages/backend/src/integrations` | 仅被 `board/shared/snapshot.ts` 使用 |
| `src/http/*` (7 引用) | `packages/backend/src/http` | → harness(`session/prompt`,`runtime/events`,`runtime/context`) + 组合根 |
| `src/app/*` (组合根) | 拆分到 **cli** 与 **backend** 各自的 `compose.ts` | 现被 `index.ts`、`http/server.ts` 使用 |
| `src/tui/*` (20 引用) | `packages/tui` | → harness |
| `src/index.ts` | `apps/cli` | → 组合根 + harness + tui |
| `src/server.ts` | `packages/backend`（入口） | → `http/server` |
| `frontend/*` | `apps/frontend` | 仅 `frontend/src/types.ts` 本地类型 → 迁到 `contracts` |

**好消息**：依赖图已经是单向的——`core` 是叶子，board/tui/http 都只向 core 看齐，没有反向依赖，也没有环。拆分主要是搬目录 + 改 import 前缀，**没有需要打断的循环依赖**。

---

## 5. 依赖规则（落地后用工具强约束）

允许：
- `harness` → 仅外部 npm 依赖（ai-sdk、zod…），**不依赖任何 workspace 包**
- `tui` → `harness`、`contracts`
- `backend` → `harness`、`contracts`
- `frontend` → `contracts`（**仅类型**，禁止 import harness/backend 运行时代码）
- `cli` → `harness`、`tui`、`backend`(compose) 

禁止：
- 任何包 → `frontend` / `tui` / `backend` 的反向依赖进入 `harness`
- `frontend` 直接 import `harness`（浏览器 ≠ Bun 运行时）

建议落地后加一条 lint/check：grep `packages/harness/src` 里不得出现 `@agent-loop/(backend|tui|frontend)`。

---

## 6. contracts 包（前后端契约）

现状：`frontend/src/types.ts` 与后端各写各的，SSE/HTTP 形状靠手工同步，易漂移。

做法：
- 把 `http/chat.ts`、`http/responses.ts`、`http/openapi.ts` 里前端要消费的请求/响应/SSE 事件类型抽到 `packages/contracts/src`
- 后端 `http/*` 与前端 `lib/*` 都从 `@agent-loop/contracts` import
- contracts **只放类型 + zod schema**，不放运行时逻辑，保证浏览器可安全引入

---

## 7. 分步迁移（每步保持 `bun run check` 绿）

> 原则：小步、可回滚、每步结束跑 `bun run check` + 相关 smoke。用 git mv 保留历史。

**Phase 0 — 脚手架（不动业务代码）**
1. 建 `tsconfig.base.json`，根 `package.json` 加 `workspaces: ["packages/*","apps/*"]`
2. 建空的 4 个包骨架（package.json + tsconfig.json + 空 src）
3. 验证：`bun install` 能解析 workspace

**Phase 1 — harness 落位（量最大、最独立）**
1. `git mv src/core packages/harness/src`
2. harness `tsconfig.json` 设 `paths: { "@/*": ["./src/*"] }`（包内仍用 `@/`，跨包用 `@agent-loop/harness`）
3. harness 导出 barrel：`packages/harness/src/index.ts` 暴露 `createRuntime`、类型、tool/plugin 接口等公共 API
4. 验证：`cd packages/harness && bunx tsc --noEmit`

**Phase 2 — contracts 抽离**
1. 从 `http/*` 提取前后端共享类型到 `packages/contracts`
2. 验证：contracts 独立 tsc 通过

**Phase 3 — backend 落位（http + board + integrations + 组合根）**
1. `git mv src/http packages/backend/src/http`、`src/board → .../board`、`src/integrations → .../integrations`
2. 新建 `packages/backend/src/compose.ts`：搬 `src/app/runtime.ts` + `src/app/plugins.ts` 的逻辑（`createRuntime({ plugins: [corePlugin, boardPlugin] })`）
3. 把跨包 import 从 `@/core/*` 改写为 `@agent-loop/harness`，`@/board`/`@/http` 改包内相对/`@/`
4. backend 入口搬 `src/server.ts`
5. 验证：`bun run sse` 起得来 + smoke

**Phase 4 — tui 落位**
1. `git mv src/tui packages/tui/src`
2. 跨包 `@/core/*` → `@agent-loop/harness`
3. 验证：`bun run tui` 起得来（smoke:tui）

**Phase 5 — cli app 落位**
1. `src/index.ts → apps/cli/src/index.ts`
2. import 改为 `@agent-loop/harness` / `@agent-loop/tui` / backend 的 `compose`
3. 验证：`bun run start --output stream "你是谁"`、`LLM_MODE=fake ... "@general ..."`

**Phase 6 — frontend 接 contracts**
1. `frontend → apps/frontend`，`frontend/src/types.ts` 改用 `@agent-loop/contracts`
2. 验证：`bun run dev`（dev-web）

**Phase 7 — 收尾**
1. 根 `package.json` scripts 改为委派到各包（`bun --filter`）
2. 更新 `AGENTS.md` / `docs/`（Local Map、Doc Routing、smoke 命令）
3. 删除空的 `src/`、`src/app/`
4. 加依赖方向 check 到 `bun run check`

---

## 8. 工具与配置要点

- **包管理**：复用现有 Bun workspaces（`bun --filter '<pkg>' run ...` 跑单包脚本）。仓库现存 `package-lock.json` 是历史残留，统一到 bun.lock 后可删。
- **TypeScript**：
  - 公共配置进 `tsconfig.base.json`，各包 `extends` 它
  - 跨包引用优先用 **TS project references**（`references` + `composite: true`）获得增量构建与正确的边界检查；包内保留 `@/*` alias
  - `jsxImportSource: @opentui/solid` 只在 tui 包需要；frontend 用自己的 solid jsx 配置——**拆开后 jsx 配置不再打架**（当前是一个 tsconfig 硬扛两套 jsx）
- **构建**：现 `scripts/build.ts` 拆成按包构建；harness 可作为库产物，backend/cli 作为可执行产物。

---

## 9. 风险与待办

- **`@/` 跨包改写量**：191 个 `@/core` 引用集中在包内（迁移后仍是 `@/`，**不用改**）；真正要改的是跨包的 ~59 处（board/tui/http/app/index 指向 core 的部分）→ `@agent-loop/harness`。可用脚本批量替换 + tsc 兜底。
- **harness 公共 API 面**：需要明确 barrel 导出哪些（runtime/tool/plugin/types），避免下游深 import 内部路径。建议迁移时顺手收敛。
- **`session/store/types` 等深路径**：board 现在深 import harness 内部（如 `core/session/store/types`）——迁移时决定是收进 barrel 还是允许 `@agent-loop/harness/session`（subpath exports）。
- **smoke 覆盖**：现有 smoke（text/harness/tui）要在拆分后逐包仍可跑通，作为每个 Phase 的验收闸。
- **postgres 可选性**：board 依赖 PG，但 cli/tui 默认不该强依赖 DB——确认 backend 不可用时 harness/cli 仍能独立运行（组合根按需注入 boardPlugin）。

---

## 10. 一句话总结

依赖图本来就干净、无环，`board` 已是 plugin、`app` 已是组合根——这次迁移本质是**"按真实分层把目录搬开 + 把跨包 import 显式化 + 抽一个 contracts 统一前后端契约"**，而非重写。风险点集中在 harness 公共 API 收敛和 jsx/tsconfig 拆分，均可控。

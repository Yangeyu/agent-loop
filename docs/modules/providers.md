# Providers

> 范围：`packages/providers`——满足 agent-core Model 端口的厂商绑定，别名 `@providers`。

## 职责

把厂商差异收敛成 `create<Vendor>Model(config)` 工厂，产出已绑定 provider/连接/目标模型的
`Model` 实例。端口（协议、投影、fake）在 `@agent-core`；这个包只加厂商加的东西：连接解析、
模型目录、协议怪癖。布局对标 LangGraph 的 partner 包 / pi 的 ai 包：**循环包里没有厂商代码**。

只有组合根（`apps/cli/src/compose.ts`）和 e2e 套件依赖它；agent-core、harness 都不依赖——
由 `check:boundaries` 强制。

## 关键入口

- `openai-compat.ts` — OpenAI 兼容协议的共享传输底座 `createOpenAICompatModel`：请求构建、
  `ModelMessage → OpenAI message` 的 1:1 映射、流解码、`image_url` 序列化。厂商差异只走两个
  hook：`extraBody`（请求体附加项）与 `readReasoning`（非标准流式字段）。底座不认识任何具体厂商。
- `dashscope.ts` — DashScope（qwen）的 `createDashScopeModel`：自有模型目录（qwen3.7-plus
  多模态、qwen3.6-flash 纯文本），按 `modelID` 解析 `spec`，未知 id 直接抛错；连接用本地 zod
  `ConnectionSchema` 声明默认，env（`DASHSCOPE_BASE_URL` / `DASHSCOPE_API_KEY`）覆盖之。

## 扩展点

- 接新厂商：新建 `src/<vendor>.ts`，导出 `create<Vendor>Model(config)`，用自己的
  `ConnectionSchema` 声明 endpoint/key 默认；走 OpenAI 兼容端点就建在 `createOpenAICompatModel`
  之上。加入 barrel 即可——引擎与 harness 都不用动。
- agent 换模型：在组合根换 `model: createXxxModel({ modelID })`。

## 约束与经验

- **厂商接线不属于引擎 config**：连接归 provider 自己声明与解析。
- **未知 modelID 抛错，不静默回退**（fail fast，见 conventions）。
- 依赖方向：`agent-core ← providers ← 组合根`；providers 永不 import harness 或 surface。

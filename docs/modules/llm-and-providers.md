# LLM 与 Provider 模块说明

## 模块职责

这一层定义统一的流式 chunk 协议、消息投影契约，以及把厂商差异收敛在 provider 内部的 **Model 实例**。核心理念：**没有 registry，没有 per-request 路由**——每个 provider 自带一个 `createXxxModel(config)` 工厂，直接产出一个已绑定 provider/连接/目标模型的 `Model` 实例（类似 langchain 的 `new ChatOpenAI({...})`）。agent 在自己的组合处持有这个实例。

## 相关文件

- `packages/harness/src/llm/index.ts` — 对外 barrel：`Model`、`createDashScopeModel`、`createOpenAICompatModel`
- `packages/harness/src/llm/types.ts` — 核心契约：`Model` / `LLMInput` / `LLMChunk` / `ModelMessage` / `ProviderModelSpec`
- `packages/harness/src/llm/message.ts` — 会话到 `ModelMessage[]` 的投影（`toModelMessages`）
- `packages/harness/src/llm/image.ts` — `ImageSource` 解析与 image_url 映射
- `packages/harness/src/llm/providers/openai-compat.ts` — OpenAI 兼容协议的共享传输底座
- `packages/harness/src/llm/providers/dashscope.ts` — DashScope（qwen）provider 的 createModel 工厂

## Model 抽象

`Model` 是这一层的中心单元（`llm/types.ts`）：

```ts
type Model = {
  readonly providerID: string        // 展示/元数据用，不用于路由
  readonly spec: ProviderModelSpec    // capabilities + contextWindow，门控中间件读它
  stream(input: LLMInput): LLMStreamResult  // provider 已绑定，绝不重新解析
}
```

构造时一次性绑定 provider、连接（baseURL/apiKey）、目标模型与其 spec；之后 `stream()` 直连，不再做任何选择。能力门控（compaction、view-image）读 `model.spec`，因此 subagent 用更小窗口/无视觉的模型时也能正确门控。

## Provider 各自提供 createModel

每个 provider 模块导出自己的 `createXxxModel(config)`：config 含 `modelID`、`temperature` 以及可选的连接覆盖 `baseURL`/`apiKey`。**连接配置由 provider 自己拥有**——厂商接线不属于引擎的行为配置（`config.ts` 只管重试/compaction/session store 等引擎策略）。DashScope 用一个自己的 `ConnectionSchema`（zod）声明默认值，env（`DASHSCOPE_BASE_URL` / `DASHSCOPE_API_KEY`）覆盖之；**默认值不在代码里硬编码 `?? DEFAULT`**。调用方不覆盖时无需传连接参数：

```ts
const model = createDashScopeModel({ modelID: "qwen3.7-plus" })
```

DashScope 拥有自己的模型目录（qwen3.7-plus 多模态、qwen3.6-flash 纯文本），按 `modelID` 解析出 `spec`。

`openai-compat.ts` 是 OpenAI 兼容协议的**共享传输底座**：只管请求构建、`ModelMessage -> OpenAI message` 的 1:1 映射、流解码。任何走 OpenAI 兼容端点的 provider 通过 `createOpenAICompatModel({ providerID, baseURL, apiKey, model, ... })` 复用它；厂商差异只通过 `extraBody`（请求体附加项，如 DashScope 的 `enable_thinking`）和 `readReasoning`（非标准流式字段，如 `reasoning_content`）两个 hook 进入。它不认识任何具体厂商。

## agent 持有 Model 实例

`AgentDefinition` = 能力（prompt/工具/中间件）+ 一个 `model: Model` 实例，两者正交。在 agent 的组合处绑定：

```ts
defineAgent({
  name: "lead",
  mode: "primary",
  model: createDashScopeModel({ modelID: "qwen3.7-plus" }),
  instructions: [...],
  tools: { ... },
})
```

loop 直接消费 `agent.model`（`ctx.model`），中间件读 `ctx.model.spec`。没有运行时注入的 `model_provider`，没有中央 `streamText`。

## 辅助模型（compaction / view-image）

需要不同模型的内部组件**就地创建**自己的 Model 实例，自包含、不外溢：

- `middleware/compaction.ts`：用 `createDashScopeModel({ modelID: "qwen3.6-flash" })` 建便宜的摘要模型，单次 `stream()` 调用，从不走 loop。`createCompaction({ summarizer })` 允许测试注入。
- `tool/view-image.ts`：就地建 qwen 视觉模型做单次图像理解调用。

## 统一协议

`llm/types.ts` 定义 runtime 与 provider 之间的契约：`ModelMessage`、`ModelContentBlock`、`LLMInput`（只含传输真正需要的 `system`/`messages`/`tools`/`temperature`/`abort`）、`LLMChunk`、`LLMStreamResult`。上层只识别 `text-delta`、`reasoning`、`tool-call`、`finish`、`error` 五类 chunk。

## 修改建议

- 接新厂商：新建 `providers/<vendor>.ts`，导出 `create<Vendor>Model(config)`，并在其中用自己的 zod `ConnectionSchema` 声明 endpoint/key 默认值（连接配置归 provider 自己，不要塞进引擎 `config.ts`）；走 OpenAI 兼容端点就建在 `createOpenAICompatModel` 之上，厂商差异只走两个 hook。
- 不要重新引入中央 registry 或 per-request 路由——模型选择只在构造 `Model` 时发生一次。
- 不要把 provider 私有格式泄漏到 session 层。
- 测试用 `tests/support/fake-model.ts` 的 `createFakeModel` 构造 stub `Model`，不依赖网络。

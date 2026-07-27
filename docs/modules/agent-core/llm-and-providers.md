# LLM 与 Provider

> 范围：`packages/agent-core` 的 `llm/`——Model 抽象与 provider。

## 职责

定义统一的流式 chunk 协议、消息投影契约，以及把厂商差异收敛在 provider 内部的 **Model 实例**。
核心理念：**没有 registry，没有 per-request 路由**——每个 provider 自带一个 `createXxxModel(config)`
工厂，直接产出已绑定 provider/连接/目标模型的 `Model`（类似 langchain 的 `new ChatOpenAI({...})`）。
agent 在自己的组合处持有这个实例。

## 关键入口

- `@agent-core/llm/types.ts` — 核心契约：`Model` / `LLMInput` / `LLMChunk` / `ModelMessage` / `ProviderModelSpec`。
- `@agent-core/llm/providers/openai-compat.ts` — OpenAI 兼容协议的共享传输底座 `createOpenAICompatModel`。
- `@agent-core/llm/providers/dashscope.ts` — DashScope（qwen）provider 的 `createDashScopeModel` 工厂。
- `@agent-core/llm/message.ts` — 会话到 `ModelMessage[]` 的投影（`toModelMessages`）。
- `@agent-core/llm/image.ts` — `ImageSource` 解析与 image_url 映射。

## 数据流

`Model` 是这一层的中心单元：

```ts
type Model = {
  readonly providerID: string        // 展示/元数据用，不用于路由
  readonly spec: ProviderModelSpec    // capabilities + contextWindow，门控中间件读它
  stream(input: LLMInput): LLMStreamResult  // provider 已绑定，绝不重新解析
}
```

- **构造时一次性绑定** provider、连接（baseURL/apiKey）、目标模型与 spec；之后 `stream()` 直连，不再选择。
- **能力门控读 `model.spec`**（compaction、view-image），所以 subagent 用更小窗口/无视觉的模型时也能正确门控。
- **provider 自带 createModel**：config 含 `modelID`、`temperature` 及可选连接覆盖；DashScope 拥有自己的
  模型目录（qwen3.7-plus 多模态、qwen3.6-flash 纯文本），按 `modelID` 解析 `spec`，未知 id 直接抛错。
- **连接配置归 provider 自己**：DashScope 用本地 zod `ConnectionSchema` 声明默认，env（`DASHSCOPE_BASE_URL` /
  `DASHSCOPE_API_KEY`）覆盖之——厂商接线不属于引擎 `config.ts`。
- **共享底座**：`openai-compat.ts` 只管请求构建、`ModelMessage → OpenAI message` 的 1:1 映射、流解码。
  任何 OpenAI 兼容端点的 provider 通过 `createOpenAICompatModel({ providerID, baseURL, apiKey, model, ... })`
  复用它；厂商差异只走两个 hook：`extraBody`（请求体附加项，如 DashScope 的 `enable_thinking`）和
  `readReasoning`（非标准流式字段，如 `reasoning_content`）。底座不认识任何具体厂商。
- **统一 chunk**：上层只识别 `text-delta`、`reasoning`、`tool-call`、`finish`、`error` 五类。

辅助模型（compaction 摘要、view-image 视觉）由需要它的组件**就地创建**自己的 Model，单次 `stream()` 调用，
从不走主循环——自包含、不外溢（见 conventions 的“模块自包含”）。

## 扩展点

- 接新厂商：新建 `providers/<vendor>.ts`，导出 `create<Vendor>Model(config)`，用自己的 zod
  `ConnectionSchema` 声明 endpoint/key 默认；走 OpenAI 兼容端点就建在 `createOpenAICompatModel` 之上。
- agent 换模型：在 agent 组合处换 `model: createXxxModel({ modelID })`，不动引擎。

## 约束与经验

- **不要重新引入中央 registry 或 per-request 路由**——模型选择只在构造 `Model` 时发生一次。
- **未知 modelID 抛错，不静默回退**到默认（fail fast，见 conventions）。
- 不要把 provider 私有格式泄漏到 session 层；映射成内部 chunk/类型再向上传。
- 测试用 `tests/support/fake-model.ts` 的 `createFakeModel` 构造 stub `Model`，不依赖网络。

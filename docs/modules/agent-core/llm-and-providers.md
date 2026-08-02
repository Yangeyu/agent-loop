# LLM：Model 端口

> 范围：`packages/agent-core` 的 `llm/`——Model 抽象、流式协议、消息投影。
> 满足这个端口的厂商绑定在独立包 `packages/providers`，见 [providers](../providers.md)。

## 职责

定义统一的流式 chunk 协议、会话到模型消息的投影，以及随包发布的 `createFakeModel` 测试替身。
核心理念：**没有 registry，没有 per-request 路由**——模型以已绑定连接与目标模型的 `Model`
实例注入（类似 langchain 的 `new ChatOpenAI({...})`），agent 在自己的组合处持有这个实例。
内核因此不含任何厂商词汇：qwen、baseURL、API key 只存在于 providers 包与组合根。

## 关键入口

- `llm/types.ts` — 端口契约：`Model` / `LLMInput` / `LLMChunk` / `ModelMessage` / `ProviderModelSpec`。
- `llm/message.ts` — 会话到 `ModelMessage[]` 的投影（`toModelMessages`）与内容块序列化
  （`serializeContentBlocks`，providers 也消费它）。
- `llm/classify.ts` — 端口层的失败分类（`classifyRetry`）：超时/网络/限流是端口的属性，
  建在其上的重试策略是消费方的（harness retry middleware）。
- `llm/fake.ts` — `createFakeModel`：脚本化 chunk 流的测试替身。

## 数据流

`Model` 是这一层的中心单元：

```ts
type Model = {
  readonly providerID: string        // 展示/元数据用，不用于路由
  readonly spec: ProviderModelSpec    // capabilities + contextWindow，门控中间件读它
  stream(input: LLMInput): LLMStreamResult  // provider 已绑定，绝不重新解析
}
```

- **构造时一次性绑定** provider、连接、目标模型与 spec；之后 `stream()` 直连，不再选择。
- **能力门控读 `model.spec`**（compaction、view-image），所以 subagent 用更小窗口/无视觉的模型
  时也能正确门控。
- **统一 chunk**：上层只识别 `text-delta`、`reasoning`、`tool-call`、`finish`、`error` 五类。

辅助模型（compaction 摘要、view-image 视觉）由需要它的组件**就地创建**自己的 Model，单次
`stream()` 调用，从不走主循环——自包含、不外溢（见 conventions 的“模块自包含”）。

## 约束与经验

- **不要重新引入中央 registry 或 per-request 路由**——模型选择只在构造 `Model` 时发生一次。
- 不要把 provider 私有格式泄漏到 session 层；映射成内部 chunk/类型再向上传。
- 单元测试一律 `createFakeModel`，不依赖网络；需要真模型的是 e2e，住 `packages/harness/e2e`。

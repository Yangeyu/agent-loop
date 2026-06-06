# LLM 与 Provider 模块说明

## 模块职责

这一层负责模型选择、统一流式 chunk 协议、provider 适配和 SSE 解码，避免上层 session 依赖具体模型厂商格式。

## 相关文件

- `packages/harness/src/llm/index.ts`
- `packages/harness/src/llm/models.ts`
- `packages/harness/src/llm/types.ts`
- `packages/harness/src/llm/content.ts`
- `packages/harness/src/llm/providers/create.ts`
- `packages/harness/src/llm/providers/qwen.ts`
- `packages/harness/src/llm/providers/fake.ts`
- `packages/harness/src/llm/providers/sse.ts`

## 统一入口

`packages/harness/src/llm/index.ts` 对上层只暴露一件事：`LLM.stream(input)`。

session 层不需要知道当前是 fake 还是 qwen，只消费统一的 `LLMChunk`。

## 模型选择

`packages/harness/src/llm/models.ts` 负责：

- 定义 `fake` 和 `qwen` 两种模型规格
- 依据 `LLM_MODE` 或 API key 自动选择 runtime
- 将 provider 的 `streamText()` 暴露给上层

默认策略是：存在 Qwen key 时优先走 qwen，否则回退 fake。

## 统一协议

`packages/harness/src/llm/types.ts` 定义了 runtime 与 provider 之间的核心契约：

- `ModelMessage`
- `ModelContentBlock`
- `LLMInput`
- `LLMChunk`
- `LLMStreamResult`

上层只识别 `text-delta`、`reasoning`、`tool-call`、`finish`、`error` 五类 chunk。

## Provider 适配骨架

`packages/harness/src/llm/providers/create.ts` 抽象出两类 provider：

- local streaming provider
- remote streaming provider

它统一处理：

- state 初始化
- 远程请求发送
- SSE 流消费
- provider payload -> `LLMChunk[]` 映射
- 异常转换为 `error` chunk

## Qwen Provider

`packages/harness/src/llm/providers/qwen.ts` 是最完整的远程适配器，负责：

- 构建 DashScope compatible 请求体
- 把内部 `ModelMessage` 序列化成 Qwen 文本协议
- 把 tool schema 映射为 function tools
- 处理 `reasoning_content`
- 累积流式 tool call 参数，并在 flush 时产出标准 `tool-call` chunk

## Fake Provider

`packages/harness/src/llm/providers/fake.ts` 主要用于 smoke 与本地回归：

- 可模拟 subagent task
- 可模拟 invalid tool args
- 可模拟 batch 工具并行
- 可模拟 nested batch
- 可模拟 structured output
- 可模拟 compaction
- 可直接返回文本答案

## SSE 解析

`packages/harness/src/llm/providers/sse.ts` 只做一件事：把 `ReadableStream<Uint8Array>` 拆成逐条 `data:` payload，供远程 provider 自己解析 JSON。

## 修改建议

- 想接新模型，优先复制 `qwen.ts` 的边界风格。
- 不要把 provider 私有格式泄漏到 session 层。
- 新增 chunk 类型前，要先确认 `SessionProcessor` 与 UI 是否都能消费。

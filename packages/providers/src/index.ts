/**
 * Concrete model providers: the vendor bindings that satisfy agent-core's
 * Model port. The port itself (stream protocol, projection, fake) lives in
 * @agent-core; this package adds only what a vendor adds — a resolved
 * connection, a model catalog, and protocol quirks. A composition root builds
 * a bound Model here and injects it; nothing below the composition root
 * depends on this package.
 */
export { createOpenAICompatModel } from "@providers/openai-compat"
export type { OpenAICompatModelConfig } from "@providers/openai-compat"
export { createDashScopeModel } from "@providers/dashscope"
export type { DashScopeConfig } from "@providers/dashscope"

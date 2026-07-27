// =============================================================================
// 阶段 A 交付物：`packages/agent-core` 的 public API 草案
// =============================================================================
//
// 纯类型 + 签名，**无实现**。这份文件不参与编译，是给人评审的。
// 通过评审后，阶段 B 在现有 `packages/harness` 内**原地**把形状改成这样
// （不搬文件），阶段 C 再物理拆包。
//
// 写法遵循 docs/plans/agent-core-extraction.md 第 2 节的构造法：
// 每一样留在下面的东西都要能回答「一个通用 agent loop 需要它吗」。
//
// ✅ 已评审通过。§10 的 3 个开放问题已拍板，结论已并入正文：
//    1. `AgentDefinition` 留 `description`、拿掉 `mode`（§4）
//    2. `TurnOutcomeReason` 开放为 `| (string & {})`，删死变体 `context_limit`（§6.3）
//    3. `beforeRun` 与 `afterRun` 都加（§6.4）
//
// -----------------------------------------------------------------------------
// 目录
//   §1  数据模型（原 packages/contracts）——新增 turn.activity
//   §2  Model 端口
//   §3  工具契约——ToolContext 收窄、describe 去上下文
//   §4  Agent 蓝图——tools: ToolDefinition[]
//   §5  执行策略
//   §6  Hook 契约——8 个 hook、RunContext / HookContext、activity()
//   §7  引擎入口——EngineDeps / runLoop / createAgent
//   §8  错误与分类
//   §9  harness 侧的对应形状（不是 core API，用来证明 core 够用）
//   §10 待拍板
// -----------------------------------------------------------------------------

// =============================================================================
// §1  数据模型 —— `agent-core/src/model.ts`（原 packages/contracts，零 import）
// =============================================================================
//
// 只列**本次有变更**的部分。其余（MessagePart / SessionMessage / StateEvent /
// SessionProjection / applyStateEvent / partsOf / messageText …）原样搬运，
// 一个字不改：state 通道的「每次会话变更恰好发一个事件」不变量是三个参照实现里
// 最干净的，没有理由动它。

export type FinishReason = "stop" | "tool-calls" | "length" | "error"

export type TurnPhase =
  | "starting"
  | "streaming"
  | "reasoning"
  | "responding"
  | "executing-tool"
  | "finishing"

export type TurnEndReason = "finish" | "error" | "abort"

export type LoopEnvelope = {
  readonly sessionID: string
  readonly rootID: string
  readonly agent: string
}

/** 一次中间件活动的三个阶段。 */
export type ActivityStatus = "start" | "update" | "end"

export type LoopEvent =
  | (LoopEnvelope & { readonly type: "session.start"; readonly text: string })
  | (LoopEnvelope & {
      readonly type: "turn.start"
      readonly messageID: string
      readonly step: number
      readonly maxSteps: number
    })
  | (LoopEnvelope & {
      readonly type: "turn.phase"
      readonly messageID: string
      readonly phase: TurnPhase
    })
  // ▲ 以上原样。▼ 新增（计划 6.5）：内核之外的参与者报告自己在做什么。
  //
  // 为什么需要它：我们把功能都放在中间件里，却配了一个封闭的核心事件词汇。
  // compaction 要跑一次完整 LLM 调用（数秒到十几秒），期间 turn.phase 停在
  // "starting"，UI 上和正常启动无法区分；重试今天连计数都不出内核。
  //
  // 为什么载荷是语义化的而不是 `data: unknown`：本仓已有先例——ToolDisplay 让
  // 工具声明 verb/target/summary，surface 从不按工具名分支。开放载荷会逼 TUI
  // 按 source 分支，把中间件已经说过的事重新猜一遍。
  | (LoopEnvelope & {
      readonly type: "turn.activity"
      readonly messageID: string
      // 产出方（用于关联同一次活动的 start/update/end），不供消费者分支渲染。
      // 由 MiddlewareStack 按 middleware.name 绑定，调用方不自报家门。
      readonly source: string
      readonly status: ActivityStatus
      // 它在做什么，中间件自己的说法："compacting history" / "retrying model call"
      readonly label: string
      // 可选补充："attempt 2 of 3" / "12k → 4k tokens"
      readonly detail?: string
    })
  | (LoopEnvelope & {
      readonly type: "turn.end"
      readonly messageID: string
      readonly step: number
      readonly reason: TurnEndReason
      readonly finishReason?: FinishReason
      readonly error?: string
      readonly durationMs: number
      readonly toolCalls: number
    })

// 以下为占位，代表原样搬运的部分。
export type SessionInfo = unknown
export type SessionMessage = unknown
export type UserMessage = unknown
export type AssistantMessage = unknown
export type MessagePart = unknown
export type ImageSource = unknown
export type StateEvent = unknown
export type ToolDisplayPatch = unknown
export type ToolMetadata = unknown
export type ToolAttachment = unknown
export type OutputFormat = { type: "json_schema"; schema: unknown }
export type ErrorInfo = { message: string; retryable: boolean; code?: string }

// =============================================================================
// §2  Model 端口 —— `agent-core/src/llm/types.ts`（决策 2：llm 留在 core）
// =============================================================================

export type ProviderModelSpec = {
  id: string
  capabilities: { vision?: boolean; reasoning?: boolean }
  contextWindow: number
}

export type Model = {
  readonly providerID: string
  readonly spec: ProviderModelSpec
  stream(input: LLMInput): LLMStreamResult
}

export type ModelMessage = unknown
export type LLMStreamResult = unknown

/** 一次模型调用的完整输入。也是 wrapModelCall 洋葱里流转的东西（§6）。 */
export type LLMInput = {
  temperature?: number
  system: string[]
  messages: ModelMessage[]
  tools: ToolDefinition[]
  abort: AbortSignal
}

// =============================================================================
// §3  工具契约 —— `agent-core/src/types.ts`
// =============================================================================

export type SessionHistoryMessage = {
  info: SessionMessage
  parts: readonly MessagePart[]
}

export type ToolExecuteResult = {
  display?: ToolDisplayPatch
  output: string
  metadata?: ToolMetadata
  attachments?: ToolAttachment[]
}

/**
 * 计划 6.1：解开一切的那个结。
 *
 * 现在是 `ToolContext = EngineDeps & { ... }`，于是「工具需要什么」自动变成
 * 「引擎必须持有什么」——workspace / skill_registry 就是这么进内核的。
 * 改为显式列举 **core 自己拥有的东西**。
 *
 * 不再有：workspace、skill_registry、agent_registry、tool_registry。
 * 需要它们的工具通过工厂闭包拿（§9）。
 */
export type ToolContext = {
  readonly sessionID: string
  /** 这次工具调用所属的 assistant 消息（turn 记录）。 */
  readonly messageID: string
  readonly agent: string
  readonly abort: AbortSignal
  readonly toolCallId?: string
  readonly format?: OutputFormat
  readonly messages: SessionHistoryMessage[]
  readonly sessions: Sessions
  readonly events: RuntimeEventBus
  readonly config: CoreConfig
  metadata(input: { display?: ToolDisplayPatch; metadata?: ToolMetadata }): Promise<void>
  executeTool(input: { toolName: string; args: unknown; toolCallId?: string }): Promise<
    { status: "completed"; result: ToolExecuteResult } | { status: "error"; error: ErrorInfo }
  >
}

export type ToolDefinition<TArgs = unknown> = {
  id: string
  description: string
  /**
   * 这次调用是关于什么的——它的动词和目标。纯函数、同步，因为它在工具 part 打开
   * **之前**运行，好让 `part.created` 一出生就带着完整 display。
   *
   * ⚠️ 变更：**去掉第二个参数**。现在是 `describe(args, ctx: {workspace, config})`，
   * 但全仓只有 read/write/edit 三个工具用它，且都只调 `ctx.workspace.resolve(path)`；
   * 没有任何 describe 读 config。§9 的工厂化之后 workspace 在闭包里，
   * 于是这个上下文参数整个消失——`ToolDescribeContext` 类型一并删除。
   *
   * 这就是构造法的答案：一个通用循环的 describe 只需要 args，别的都是工具自己的。
   */
  describe?(args: TArgs): ToolDisplayPatch
  parameters: unknown // z.ZodType<TArgs>
  validate(args: unknown):
    | { success: true; data: TArgs }
    | { success: false; error: ErrorInfo }
  execute(args: TArgs, ctx: ToolContext): Promise<ToolExecuteResult>
}

export type AnyToolDefinition = ToolDefinition<unknown>

// =============================================================================
// §4  Agent 蓝图 —— `agent-core/src/blueprint.ts`
// =============================================================================

export type AgentDefinition = {
  name: string
  /**
   * agent 的自述。留在 core：任何 agent 系统都有这个元数据（pi / LangChain 都有），
   * core 的错误信息也用得上。
   *
   * 对比 `mode`——它**拿掉了**（§10 问题 1 的结论）。构造法：一个通用循环不需要
   * 知道「这个 agent 是子 agent」，那是委派概念。查实 core 一处不读；读者是
   * harness 的 task 工具（isDelegable）与 agent_registry.defaultAgent()。
   * harness 用 `HarnessAgent = AgentDefinition & { mode }` + `defineHarnessAgent`
   * 补上——那一层 harness 本来就要有（它还要塞 skills/subagents 的富 create-agent）。
   */
  description?: string
  model: Model
  /**
   * agent 自己的话。引擎把它们播种进 context draft，于是一个零中间件的 agent
   * 也能说出自己的蓝图；它们如何与系统提示的其余部分排序是编排层的事。
   */
  instructions: string[]
  /**
   * 决策 1：`Record<string, boolean>` → `ToolDefinition[]`。
   *
   * 这是 core 摆脱 tool_registry 的关键。「按名声明 + 注册表解析」纯粹是编排层
   * 便利（让配置/文件能引用工具）；core 里 agent 直接持有工具定义。
   *
   * 查实：调用点其实**已经**这么做了——`prepareToolCall` 是
   * `ctx.tools.find(t => t.id === call.toolName)`，从数组查，不碰 registry。
   * registry 只在 `runLoop` 顶上出现一次（`toolsForAgent`），就是这次要拿掉的那次。
   */
  tools: ToolDefinition[]
  steps?: number
  maxToolCalls?: number
  format?: OutputFormat
  /** 创建 AgentRun 时执行；返回组成这个 agent 能力的中间件（run 级，每次实例化）。 */
  assemble(): { middleware: MiddlewareFactory[] }
}

export type AgentSpec = {
  name: string
  description?: string
  model: Model
  instructions?: string[]
  tools?: ToolDefinition[]
  steps?: number
  maxToolCalls?: number
  format?: OutputFormat
  middleware?: MiddlewareFactory[]
}

export declare function defineAgent(spec: AgentSpec): AgentDefinition

// =============================================================================
// §5  执行策略 —— `agent-core/src/policy.ts`
// =============================================================================
//
// 变更：
//   - 删 `TurnBudgetPolicy.maxSubagentDepth`（死字段：只有声明与赋值，无人读取；
//     task 读的是 config.subagent_max_depth）
//   - 删 `TurnExecutionPolicy.retry` + `RetryPolicy`（决策 6：重试策略外置，
//     变成 createRetry 的入参）
//   - `resolveSessionDepth` / `getDelegationDepthInfo` 移出 → harness 的 task 工具
//     （第二判据：它们和 task 共享「谁可被委派」这个不变量）

export type TimeoutPolicy = {
  turnTimeoutMs: number
}

export type TurnBudgetPolicy = {
  maxAgentSteps: number
  maxRunToolCalls: number
  maxSessionSteps: number
  sessionStepsUsed: number
  sessionStepsRemaining: number
}

export type TurnExecutionPolicy = {
  timeout: TimeoutPolicy
  /** 一轮 fan-out 内并发执行的工具数上限。按轮解析，不是共享信号量。 */
  toolConcurrency: number
  budget: TurnBudgetPolicy
}

export declare function resolveTurnExecutionPolicy(
  config: CoreConfig,
  agent: AgentDefinition,
  session: SessionInfo,
): TurnExecutionPolicy

export declare function isFinalAllowedStep(budget: TurnBudgetPolicy, step: number): boolean

export declare function createTurnAbortSignal(input: {
  parent?: AbortSignal
  timeoutMs: number
}): { signal: AbortSignal; dispose(): void }

// =============================================================================
// §6  Hook 契约 —— `agent-core/src/hooks.ts`（决策 5、7、8）
// =============================================================================

// -----------------------------------------------------------------------------
// 6.1  为什么改名
// -----------------------------------------------------------------------------
//
// 当前命名一半语义一半位置（`assembleContext` / `judgeTurn` 是语义，
// `beforeTurn` / `beforeToolCall` 是位置），于是**读不出执行顺序**：
// `beforeTurn` 与 `assembleContext` 都在模型调用前跑，从名字看不出谁先谁后。
//
// 采用 `<position><Subject>` 之后整组名字按执行顺序连读：
//
//   beforeRun
//     ├─ ( beforeTurn                       ← 门控 + 副作用点
//     │    → beforeModelCall                ← 纯折叠 (ctx, draft) => draft
//     │    → wrapModelCall( ⟨one stream⟩ )  ← 洋葱，retry 落在这里
//     │    → ( beforeToolCall → execute → afterToolCall )*
//     │    → afterTurn )*                   ← 终态 + 循环续断，折叠
//     └─ afterRun                           （finally 里跑，异常也执行）
//
// 三个独立实现收敛到同一组拦截点，这是对契约形状最有力的验证：
//
//   pi-agent-core        LangChain v1 middleware   我们（改名后）
//   ────────────────     ───────────────────────   ─────────────────
//   transformContext     before_model              beforeModelCall
//   —                    wrap_model_call           wrapModelCall     ← 新增
//   —                    after_model               afterTurn
//   beforeToolCall       wrap_tool_call            beforeToolCall
//   afterToolCall        ↑ 同一个                   afterToolCall
//   agent_start/end      before_agent/after_agent  beforeRun/afterRun ← 新增
//   —                    —                         beforeTurn
//
// **为什么不照抄 LangChain 的 subject 划分**（agent / model / tool）：它的执行
// 模型里没有 turn 这一层。我们有——一个 turn = 一次模型调用 + 它那批工具调用，
// 而且 beforeTurn 是承重的：compaction 在那里写 session history，故意不放进纯
// 折叠。丢掉 turn 这个 subject 会把「纯折叠 vs 副作用点」的区分一起丢掉。
//
// **为什么 tool 侧不改成 wrap 形态**：我们刻意让门控顺序执行、执行并发
// （turn.ts 的 prepareToolCall / executeToolCall 分离），因为计数型 guard 只有
// 顺序到达才正确。wrap 包住整个调用，并发跑会让两个调用同时读到「还剩 1 次」。
// model 侧没有这个约束（一轮一次调用），wrap 干净可用。

// -----------------------------------------------------------------------------
// 6.2  Run 上下文 / Hook 上下文
// -----------------------------------------------------------------------------
//
// 新增 `beforeRun` / `afterRun` 逼出一个诚实的类型拆分：run 开始时**还没有**
// turn，没有 messageID、没有 step、没有 policy。与其塞假值，不如把 run 级字段
// 单独立出来，HookContext 在它上面加 turn 级的。这顺带把「什么是 run 级、什么是
// turn 级」变成类型事实而不是注释。

/** run 级、整个循环期间不变的东西。 */
export type RunContext = {
  readonly config: CoreConfig
  readonly sessions: Sessions
  readonly agent: AgentDefinition
  readonly sessionID: string
  /** run 的根 abort（turn 级的更窄，见下）。 */
  readonly abort: AbortSignal
  /**
   * 当前 agent 绑定的模型实例。门控中间件读它的 spec（capabilities/contextWindow）；
   * 也可直接调用，用于必须绕开中间件栈的一次性带外调用（避免重入）。
   */
  readonly model: Model
}

/** turn 级：run 上下文 + 这一轮的东西。 */
export type HookContext = RunContext & {
  /** 这一轮的 assistant 消息——每个 turn 级 hook 读或改的那条记录。 */
  readonly messageID: string
  readonly step: number
  readonly policy: TurnExecutionPolicy
  /** 这一轮的 abort（父 = run 的 abort，外加 turn 超时）。 */
  readonly abort: AbortSignal
  /** 本轮请求的结构化输出格式（来自用户消息）。 */
  readonly format?: OutputFormat
  /**
   * 报告这个中间件正在做什么（计划 6.5）。发 turn.activity 事件。
   *
   * 取代原来的 `HookContext.events`（查实：**零中间件读取**——中间件不该拿到
   * 整条总线，它只需要报告自己的活动。「middleware 是决策层、event bus 是只读
   * 观察层」这个分工因此保住）。
   *
   * `source` 由 MiddlewareStack 在派发时按 middleware.name 绑定。
   */
  readonly activity: (input: { label: string; detail?: string }) => ActivityHandle
}

export type ActivityHandle = {
  update(detail: string): void
  /** 幂等：重复调用忽略。中间件用 try/finally 收尾是安全的。 */
  end(detail?: string): void
}

// 相对今天**删掉**的 HookContext 字段（全部查实零读者）：
//   rootID            —— 只有引擎发事件信封时用，中间件零读取
//   events            —— 零中间件读取，被 activity() 取代
//   agent_registry    —— 决策 1 + §9 工厂化后，subagentList contributor 自带
//   skill_registry    —— 同上，availableSkills contributor 自带

// -----------------------------------------------------------------------------
// 6.3  hook 的输入输出类型
// -----------------------------------------------------------------------------

/**
 * ⚠️ 变更：从**封闭联合**改为**开放联合**。
 *
 * 查实：9 个变体里 core 只产出 5 个（assistant_error / tool_calls /
 * empty_assistant / final_text / completed_without_output）；4 个是 harness
 * 中间件产出的（structured_output / step_budget_reached /
 * step_budget_reached_without_answer）；`context_limit` **全仓零生产者**——
 * 声明在联合里，从来没人发过。
 *
 * 这是 LoopEvent 那个病的同一株：把功能放在中间件里，却给了它一个封闭的核心
 * 词汇。开放它的代价接近零——这个类型从不离开引擎（turn.end 事件带的是另一个
 * 类型 TurnEndReason），唯一的分支是 budget 中间件判 `=== "empty_assistant"`，
 * 那是个 core 值。
 *
 * `(string & {})` 是 TS 里「开放联合但保留自动补全」的标准写法。
 */
export type TurnOutcomeReason =
  | "tool_calls"
  | "empty_assistant"
  | "assistant_error"
  | "final_text"
  | "completed_without_output"
  | (string & {})

export type ToolCall = {
  toolName: string
  toolCallId: string
  args: unknown
}

export type TurnGate =
  | { proceed: true }
  | { proceed: false; reason: TurnOutcomeReason; note?: string }

export type ToolGate =
  | { action: "proceed"; args?: unknown }
  | { action: "deny"; error: ErrorInfo; note?: string }

/** 一轮组装中的模型输入：system 片段 + 变换后的消息历史。 */
export type ContextDraft = {
  system: string[]
  messages: ModelMessage[]
}

export type ToolOutcome =
  | { ok: true; result: ToolExecuteResult }
  | { ok: false; error: ErrorInfo; stop?: boolean; note?: string }

export type TurnTerminal =
  | { ok: true; structured?: unknown; finishReason?: FinishReason }
  | { ok: false; error: ErrorInfo }

export type TurnOutcome =
  | { kind: "continue"; reason: TurnOutcomeReason }
  | { kind: "break"; reason: TurnOutcomeReason; note?: string }

export type TurnJudgment = {
  readonly finish: { readonly finishReason?: FinishReason; readonly text: string }
  readonly terminal?: TurnTerminal
  readonly outcome: TurnOutcome
}

/**
 * `wrapModelCall` 洋葱里流转的结果：**一次**流式模型调用的产出。
 *
 * ⚠️ 与计划 6.6 字面表述的偏差（有意的）：计划说「turn.ts 只负责发起一次流式
 * 调用，把它交给 wrapModelCall 洋葱」。落到代码上有两种切法：
 *
 *   (a) wrap 只包**流**，工具批次在 wrap 之外跑
 *   (b) wrap 包住今天的 runStreamOnce（流 + 它引发的工具批次）
 *
 * 选 (a)。理由不是审美：查实今天 `runStreamOnce` 里能抛出的只有三处——
 * `model.stream()` 建流、流中 `chunk.type === "error"`、`abort.throwIfAborted()`，
 * 而 `runToolCalls` 不抛（它返回 stop/continue）。所以**重试窗口今天就严格落在
 * 流阶段**，(a) 与 (b) 行为完全等价。而 (a) 让 `wrapModelCall` 这个名字为真，
 * 也让 6.1 的执行顺序图字面成立。
 */
export type ModelCallResult = {
  /** 模型干净收尾时的 finishReason；因工具停止/中断而提前结束时缺席。 */
  readonly finishReason?: FinishReason
  /** 这次调用中模型发出的工具调用，按发出顺序。turn 在 wrap 返回后执行它们。 */
  readonly toolCalls: readonly ToolCall[]
}

/** run 结束时交给 afterRun 的小结。 */
export type RunSummary = {
  readonly steps: number
  readonly reason: TurnOutcomeReason
}

// -----------------------------------------------------------------------------
// 6.4  Middleware
// -----------------------------------------------------------------------------

export type Middleware = {
  name: string

  /** run 级 setup。构造函数做不了的异步初始化。不设门控（run 级拒绝 == 拒绝第一轮，
   *  beforeTurn 已经能做）。 */
  beforeRun?(ctx: RunContext): void | Promise<void>

  /** 门控 + **副作用**点：第一个拒绝短路。compaction 在这里写 session history，
   *  故意不放进纯折叠。 */
  beforeTurn?(ctx: HookContext): TurnGate | Promise<TurnGate>

  /** 纯折叠：draft 按注册顺序流过整个栈。（原 assembleContext，签名不变） */
  beforeModelCall?(ctx: HookContext, draft: ContextDraft): ContextDraft | Promise<ContextDraft>

  /**
   * 洋葱：注册顺序里靠前的在外层。可以改写请求、可以重试、可以短路。
   * retry 中间件落在这里（§9）。
   */
  wrapModelCall?(
    ctx: HookContext,
    request: LLMInput,
    next: (request: LLMInput) => Promise<ModelCallResult>,
  ): Promise<ModelCallResult>

  /** 门控：第一个 deny 短路，args 顺着穿。 */
  beforeToolCall?(ctx: HookContext, call: ToolCall): ToolGate | Promise<ToolGate>

  /** 工具结算：成功与失败共用入口；第一个 stop 胜出。 */
  afterToolCall?(
    ctx: HookContext,
    call: ToolCall,
    outcome: ToolOutcome,
  ): ToolOutcome | Promise<ToolOutcome>

  /** 一轮一次的判决：终态 + 循环续断，左折叠。（原 judgeTurn，签名不变） */
  afterTurn?(ctx: HookContext, judgment: TurnJudgment): TurnJudgment | Promise<TurnJudgment>

  /** run 级 teardown。在 `finally` 里跑，所以异常路径也会执行。
   *  这是今天**完全没有**的能力：开了资源（子进程、临时目录）的中间件无处关闭。 */
  afterRun?(ctx: RunContext, summary: RunSummary): void | Promise<void>
}

/** 每个 AgentRun（循环）实例化一次，所以中间件可以在闭包里持有 run 级状态。 */
export type MiddlewareFactory = () => Middleware

/**
 * 有序派发。每个 hook 的语义：
 *   beforeRun / afterRun     顺序跑完全部（afterRun 逆序，成对的 teardown 惯例）
 *   beforeTurn               第一个拒绝短路
 *   beforeModelCall          左折叠
 *   wrapModelCall            洋葱，注册顺序靠前的在外层
 *   beforeToolCall           第一个 deny 短路（args 顺着穿）
 *   afterToolCall            左折叠，第一个 stop 短路
 *   afterTurn                左折叠
 *
 * 派发时给每个中间件一个 **source 已绑定** 的 ctx 视图（activity 的 source =
 * middleware.name），中间件不必自报家门。
 */
export declare class MiddlewareStack {
  static build(factories: MiddlewareFactory[]): MiddlewareStack

  beforeRun(ctx: RunContext): Promise<void>
  beforeTurn(ctx: HookContext): Promise<TurnGate>
  beforeModelCall(ctx: HookContext, draft: ContextDraft): Promise<ContextDraft>
  wrapModelCall(
    ctx: HookContext,
    request: LLMInput,
    base: (request: LLMInput) => Promise<ModelCallResult>,
  ): Promise<ModelCallResult>
  beforeToolCall(ctx: HookContext, call: ToolCall): Promise<ToolGate>
  afterToolCall(ctx: HookContext, call: ToolCall, outcome: ToolOutcome): Promise<ToolOutcome>
  afterTurn(ctx: HookContext, judgment: TurnJudgment): Promise<TurnJudgment>
  afterRun(ctx: RunContext, summary: RunSummary): Promise<void>
}

// =============================================================================
// §7  引擎入口 —— `agent-core/src/{context,loop,create-agent}.ts`
// =============================================================================

export type Sessions = unknown // 原样搬运
export type RuntimeEventBus = { state: unknown; loop: { emit(e: LoopEvent): void } }

/**
 * 引擎的依赖面。**这是本次重构最短的那个 diff，也是最能说明问题的那个**：
 * 从 7 个字段减到 3 个。去掉的四个——agent_registry / skill_registry /
 * tool_registry / workspace——没有一个是「通用 agent loop 需要」的。
 */
export type EngineDeps = {
  config: CoreConfig
  sessions: Sessions
  events: RuntimeEventBus
}

/** 引擎内部的每轮上下文：HookContext + 这一轮解析出来的输入。 */
export type TurnContext = HookContext & {
  readonly user: UserMessage
  readonly tools: readonly ToolDefinition[]
  readonly rootID: string
  /** source 待绑定的 activity 工厂；MiddlewareStack 由它派生每个中间件的 activity。 */
  readonly openActivity: (input: {
    source: string
    label: string
    detail?: string
  }) => ActivityHandle
}

/**
 * 驱动一个已经播好种的会话的 turn 循环。core 的唯一循环入口。
 *
 * 注意它收的是 `AgentDefinition` **不是 agent 名字**——这个接缝今天就存在，
 * 所以「按名解析 + 追加用户消息」的 `runSession` 天然属于 harness（§9）。
 */
export declare function runLoop(
  deps: EngineDeps,
  input: { sessionID: string; agent: AgentDefinition; abort?: AbortSignal },
): Promise<SessionInfo>

/** 引擎旋钮，仅此而已。harness 的 config 类型 extends 它（§9）。 */
export type CoreConfig = {
  session_max_steps: number
  turn_timeout_ms: number
  run_max_tool_calls: number
  tool_max_concurrency: number
  session_store: "memory" | "file"
  session_store_dir: string
}

/**
 * 独立 agent 原子（决策 3 的最小版）：model + tools + middleware 包成一个可直接
 * 跑的单元，引擎依赖私有（默认内存会话）。
 *
 * 没有 subagents、没有 skills、没有 workspace——那些是 harness 富版本的事。
 * **阶段 E 的验收就是只用这个入口搭一个 agent 并跑通。**
 */
export declare function createAgent(spec: {
  name?: string
  model: Model
  instructions?: string[]
  middleware?: MiddlewareFactory[]
  tools?: ToolDefinition[]
  steps?: number
  format?: OutputFormat
  config?: Partial<CoreConfig>
  events?: RuntimeEventBus
}): {
  definition: AgentDefinition
  events: RuntimeEventBus
  sessions: Sessions
  run(input: {
    text: string
    sessionID?: string
    format?: OutputFormat
    images?: ImageSource[]
    abort?: AbortSignal
  }): Promise<SessionInfo>
}

// =============================================================================
// §8  错误与分类 —— `agent-core/src/error.ts` + `agent-core/src/llm/classify.ts`
// =============================================================================
//
// 计划 5.5 的拆分：`retry()` / `retryDelay()` / `RetryPolicy` **不在这里**，
// 它们去 harness 的中间件（重试策略是可替换行为）。留在 core 的是：

/** turn.ts 判终态在用，与重试无关。 */
export declare function isAbortError(error: unknown): boolean
export declare function toErrorInfo(error: unknown, retryable: boolean): ErrorInfo

/**
 * 「这个 provider 错误可不可重试」是 **Model 端口的失败分类**——任何包裹模型调用
 * 的人都需要它，不只是我们那一个重试策略。所以它跟着 Model 端口走。
 */
export type RetryCategory = "abort" | "timeout" | "network" | "availability" | "rate_limit" | "unknown"
export type RetryClassification = {
  retryable: boolean
  category: RetryCategory
  reason?: string
}
export declare function classifyRetry(error: unknown): RetryClassification

// =============================================================================
// §9  harness 侧的对应形状
// =============================================================================
//
// 不是 core API。列在这里是为了**证明上面的 core 够用**——如果哪一条在 core 的
// 契约下写不出来，说明 core 切错了。

// --- 9.1  retry 外置（决策 6 / 计划 5.5、6.6）--------------------------------
//
// declare function createRetry(input: {
//   maxRetries: number
//   baseDelayMs: number
//   maxDelayMs: number
// }): MiddlewareFactory
//
// 实现 wrapModelCall：
//   async wrapModelCall(ctx, request, next) {
//     for (let attempt = 0; ; attempt += 1) {
//       try { return await next(request) }
//       catch (error) {
//         if (attempt >= maxRetries || !classifyRetry(error).retryable) throw error
//         const handle = ctx.activity({
//           label: "retrying model call",
//           detail: `attempt ${attempt + 1} of ${maxRetries}`,
//         })
//         try { await sleep(retryDelay(attempt + 1, policy), ctx.abort) }
//         finally { handle.end() }
//       }
//     }
//   }
//
// 尝试计数放在这一次 wrapModelCall 调用的闭包里 → 天然按轮重置，
// `recorder.retries` / `recorder.recordRetry()` 一并删除（今天是纯内部计数器，
// 只被 turn.ts 的 shouldRetry 读，不写进消息、不在事件词汇里、TUI 完全看不到）。
//
// 加入 baseMiddleware()，因此**行为不变**——除了重试第一次变得可观测。

// --- 9.2  工具与 contributor 改工厂，自带依赖（计划 6.2）----------------------
//
// 仓库里已有这个模式：createViewImageTool({ model: visionModel })。套用到其余：
//
//   createReadTool({ workspace })      createWriteTool({ workspace })
//   createEditTool({ workspace })      createGrepTool({ workspace })
//   createBashTool({ workspace })      createPresentFilesTool({ workspace })
//   createSkillTool({ skills })
//   createTaskTool({ agents, config })         ← 委派需要 agent 注册表 + 深度配置
//   createTaskResumeTool({ agents, config })
//
// prompt contributor 同理（skill_registry / agent_registry 离开 HookContext 后必须）：
//   createAvailableSkills({ skills }): PromptContributor
//   createSubagentList({ agents }):    PromptContributor
//
// ⚠️ 装配顺序上有一个看起来像循环的地方，实际不是：
//     createTaskTool 需要 agents，而 lead agent 需要 task 工具。
//   解法是 agents 传的是 **registry 而不是数组**——registry 在装配时创建、
//   之后填充，task 只在 execute/contribute 时才 list()。所以：
//     const agents = createAgentRegistry()
//     const tools  = createCoreTools({ visionModel, workspace, skills, agents, config })
//     agents.register(createLeadAgent({ model, summarizer, tools: pick(tools, [...]) }))
//   这也解释了为什么 registry.ts 留在 harness 是对的：它的价值是**延迟解析**，
//   而通用循环跑的是一个已经解析好的 agent。

// --- 9.3  runSession 留在 harness --------------------------------------------
//
// declare function runSession(
//   deps: EngineDeps & { agents: AgentRegistry },
//   input: { sessionID: string; text: string; agent?: string; format?: OutputFormat;
//            images?: ImageSource[]; abort?: AbortSignal },
// ): Promise<SessionInfo>
//
// 它做的两件事都不是循环原语：按名解析 agent（需要 registry）、
// 追加用户消息并发 session.start。做完调 core 的 runLoop。

// --- 9.4  config 分层 ---------------------------------------------------------
//
// type HarnessConfig = CoreConfig & {
//   workspace_root: string
//   skills_dir: string
//   subagent_max_depth: number
//   compaction_trigger_ratio: number
//   compaction_retain_ratio: number
//   model_max_retries: number            ← 转为 createRetry 入参
//   model_retry_base_delay_ms: number
//   model_retry_max_delay_ms: number
// }

// --- 9.5  prompt 轴原样（计划第 8 节：本次不动）-------------------------------
//
// PromptSlot / SLOT_ORDER / SystemSection / PromptContributor / promptAssembly
// 全部留在 harness，只搬位置 + 9.2 的工厂化。
// promptAssembly 实现的 hook 从 assembleContext 改名为 beforeModelCall。

// =============================================================================
// §10  待拍板（进阶段 B 前需要你确认）
// =============================================================================
//
// 这三条都是执行中用构造法查出来的，计划第 3 节的 8 条决策没有覆盖。
// 我给了推荐，但都会改变 core 的公开形状，所以不自己拍。
//
// ─────────────────────────────────────────────────────────────────────────────
// 问题 1：`AgentDefinition.mode` 与 `description` 该不该留在 core？
//   ✅ 结论：**留 description，拿掉 mode。** 已并入 §4。
//   harness 补 `HarnessAgent = AgentDefinition & { mode }` + `defineHarnessAgent`。
//
// ─────────────────────────────────────────────────────────────────────────────
// 问题 2：`TurnOutcomeReason` 开放为 `| (string & {})`？
//   ✅ 结论：**开放，并删掉零生产者 `context_limit`。** 已并入 §6.3。
//   代价（失去 exhaustive 检查）明确接受：今天也没人对它做 exhaustive switch。
//
// ─────────────────────────────────────────────────────────────────────────────
// 问题 3：`beforeRun` / `afterRun` 这一轮加不加？
//   ✅ 结论：**两个都加**（计划 6.4 原文，不收窄）。已并入 §6.4。
//   代价明确接受：`beforeRun` 本轮零实现方，暂时打破「每个 hook 都有实现方」
//   这条纪律。它的辩护是与 pi（agent_start/end）、LangChain
//   （before_agent/after_agent）完全对位，且命名成对读起来最顺。
//
// ─────────────────────────────────────────────────────────────────────────────
//
// 另外，两条**已经按计划执行、无需确认**、但值得记录的形状变化：
//   · `describe` 去掉第二个参数（§3）——ToolDescribeContext 类型消失
//   · `wrapModelCall` 只包流不包工具批次（§6.3 ModelCallResult 的注释）——
//     行为等价，已查实重试窗口今天就只在流阶段

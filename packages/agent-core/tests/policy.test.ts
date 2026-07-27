import { describe, expect, it } from "bun:test"
import { defineHarnessAgent } from "@harness/registry"
import { isFinalAllowedStep, resolveTurnExecutionPolicy } from "@agent-core/policy"
import { loadConfigFromEnv, type Config } from "@harness/config"
import { createDashScopeModel } from "@agent-core/llm/providers/dashscope"
import type { AssistantMessage, SessionInfo } from "@agent-core/types"

const model = createDashScopeModel({ modelID: "qwen3.7-plus" })

function makeSession(assistantTurns: number): SessionInfo {
  const messages: AssistantMessage[] = Array.from({ length: assistantTurns }, (_, index) => ({
    id: `assistant-${index}`,
    role: "assistant",
    parentID: "user-1",
    agent: "lead",
    model: { providerID: "dashscope", modelID: "qwen3.7-plus" },
    time: { created: 0 },
  }))

  return {
    id: "session-1",
    rootID: "session-1",
    title: "Test session",
    messages,
    parts: {},
  }
}

function resolve(input: { agentSteps: number; assistantTurns: number; config?: Partial<Config> }) {
  const config = { ...loadConfigFromEnv({}), ...input.config }
  const agent = defineHarnessAgent({ name: "lead", mode: "primary", model, steps: input.agentSteps })
  return resolveTurnExecutionPolicy(config, agent, makeSession(input.assistantTurns)).budget
}

describe("resolveTurnExecutionPolicy budgets", () => {
  it("keeps the agent cap and the session remainder as independent numbers", () => {
    const budget = resolve({ agentSteps: 20, assistantTurns: 12, config: { session_max_steps: 100 } })

    expect(budget.maxAgentSteps).toBe(20)
    expect(budget.sessionStepsUsed).toBe(12)
    expect(budget.sessionStepsRemaining).toBe(88)
  })

  it("lets a run use its full step cap instead of stopping at half the session budget", () => {
    // The regression: combining the caps with min() compared a climbing step
    // counter against a shrinking remainder, so a run died at session_max/2.
    const agentSteps = 20
    for (let step = 1; step < agentSteps; step += 1) {
      const budget = resolve({ agentSteps, assistantTurns: step - 1, config: { session_max_steps: 100 } })
      expect(isFinalAllowedStep(budget, step)).toBe(false)
    }

    const last = resolve({ agentSteps, assistantTurns: agentSteps - 1, config: { session_max_steps: 100 } })
    expect(isFinalAllowedStep(last, agentSteps)).toBe(true)
  })

  it("stops on the session budget when the session is nearly spent", () => {
    const budget = resolve({ agentSteps: 20, assistantTurns: 9, config: { session_max_steps: 10 } })

    expect(budget.sessionStepsRemaining).toBe(1)
    expect(isFinalAllowedStep(budget, 3)).toBe(true)
  })

  it("prefers a per-agent tool-call cap over the runtime default", () => {
    const config = { ...loadConfigFromEnv({}), run_max_tool_calls: 32 }
    const declared = defineHarnessAgent({ name: "lead", mode: "primary", model, maxToolCalls: 64 })
    const inherited = defineHarnessAgent({ name: "general", mode: "subagent", model })

    expect(resolveTurnExecutionPolicy(config, declared, makeSession(0)).budget.maxRunToolCalls).toBe(64)
    expect(resolveTurnExecutionPolicy(config, inherited, makeSession(0)).budget.maxRunToolCalls).toBe(32)
  })
})

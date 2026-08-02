import { describe, expect, it } from "bun:test"
import { defineAgent } from "@agent-core/agent"
import { isFinalAllowedStep, resolveStepExecutionPolicy } from "@agent-core/policy"
import { DEFAULT_CORE_CONFIG, type CoreConfig } from "@agent-core/config"
import { createFakeModel } from "@agent-core/llm/fake"
import type { AssistantMessage, SessionInfo } from "@agent-core/model"

const model = createFakeModel()

function makeSession(assistantSteps: number): SessionInfo {
  const messages: AssistantMessage[] = Array.from({ length: assistantSteps }, (_, index) => ({
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

function resolve(input: { agentSteps: number; assistantSteps: number; config?: Partial<CoreConfig> }) {
  const config = { ...DEFAULT_CORE_CONFIG, ...input.config }
  const agent = defineAgent({ name: "lead", model, steps: input.agentSteps })
  return resolveStepExecutionPolicy(config, agent, makeSession(input.assistantSteps)).budget
}

describe("resolveStepExecutionPolicy budgets", () => {
  it("keeps the agent cap and the session remainder as independent numbers", () => {
    const budget = resolve({ agentSteps: 20, assistantSteps: 12, config: { session_max_steps: 100 } })

    expect(budget.maxAgentSteps).toBe(20)
    expect(budget.sessionStepsUsed).toBe(12)
    expect(budget.sessionStepsRemaining).toBe(88)
  })

  it("lets a run use its full step cap instead of stopping at half the session budget", () => {
    // The regression: combining the caps with min() compared a climbing step
    // counter against a shrinking remainder, so a run died at session_max/2.
    const agentSteps = 20
    for (let step = 1; step < agentSteps; step += 1) {
      const budget = resolve({ agentSteps, assistantSteps: step - 1, config: { session_max_steps: 100 } })
      expect(isFinalAllowedStep(budget, step)).toBe(false)
    }

    const last = resolve({ agentSteps, assistantSteps: agentSteps - 1, config: { session_max_steps: 100 } })
    expect(isFinalAllowedStep(last, agentSteps)).toBe(true)
  })

  it("stops on the session budget when the session is nearly spent", () => {
    const budget = resolve({ agentSteps: 20, assistantSteps: 9, config: { session_max_steps: 10 } })

    expect(budget.sessionStepsRemaining).toBe(1)
    expect(isFinalAllowedStep(budget, 3)).toBe(true)
  })

  it("prefers a per-agent tool-call cap over the runtime default", () => {
    const config = { ...DEFAULT_CORE_CONFIG, run_max_tool_calls: 32 }
    const declared = defineAgent({ name: "lead", model, maxToolCalls: 64 })
    const inherited = defineAgent({ name: "general", model })

    expect(resolveStepExecutionPolicy(config, declared, makeSession(0)).budget.maxRunToolCalls).toBe(64)
    expect(resolveStepExecutionPolicy(config, inherited, makeSession(0)).budget.maxRunToolCalls).toBe(32)
  })
})

// The system prompt's shape, asserted end to end: these run a real turn and read
// back the `system` array the model actually received. The behaviour under test
// is ordering, which used to be an emergent property of each agent's middleware
// array and therefore untestable by construction.
import { describe, expect, it } from "bun:test"
import { defineHarnessAgent } from "@harness/registry"
import {
  baseMiddleware,
  createCoreTestRuntime,
  createTestRuntime,
  promptAssembly,
  runPrompt,
  type HarnessAgent,
  type PromptContributor,
  type SkillInfo,
} from "@harness"
import {
  defineTool,
} from "@agent-core"
import type { LLMChunk, Model } from "@agent-core/llm/types"
import { z } from "zod"
import { createFakeModel } from "@agent-core"

// A turn that ends the loop: `baseOutcome` continues on an empty assistant, so a
// script with no text would spin forever on an agent that caps nothing. The text
// is valid JSON so the same script also satisfies a structured-output run.
const DONE: LLMChunk[] = [
  { type: "text-delta", textDelta: "{}" },
  { type: "finish", finishReason: "stop" },
]
const JSON_FORMAT = { type: "json_schema" as const, schema: { type: "object" } }

// A tool that does nothing but keep the loop running for another step.
const NOOP_TOOL = defineTool({
  id: "noop",
  description: "Does nothing.",
  parameters: z.object({}),
  async execute() {
    return { output: "ok" }
  },
})

// A model that records every turn's system fragments and replays one script per
// call (the last script repeats), so a test can drive a multi-step loop.
function recordingModel(scripts: LLMChunk[][] = [DONE]) {
  const systems: string[][] = []
  const base = createFakeModel()
  let call = 0

  const model: Model = {
    ...base,
    stream(input) {
      systems.push([...input.system])
      const chunks = scripts[Math.min(call, scripts.length - 1)]
      call += 1
      return {
        fullStream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      }
    },
  }

  return { model, systems }
}

// A probe agent composed by hand: it holds its own tools, so nothing else needs
// registering.
async function run(options: { agents: HarnessAgent[]; skills?: SkillInfo[]; format?: typeof JSON_FORMAT }) {
  const runtime = createTestRuntime({ agents: options.agents, skills: options.skills })
  await runPrompt({ runtime, agent: options.agents[0].name, text: "do the thing", format: options.format })
}

// The real standard assembly, which is the only way to see what the shipped
// agents actually say. `patch` amends the lead in place for the cases that need
// a different budget than the shipped one.
async function runCore(options: {
  model: Model
  skills?: SkillInfo[]
  format?: typeof JSON_FORMAT
  agents?: "lead-only" | "both"
  patchLead?: Partial<HarnessAgent>
}) {
  const runtime = createCoreTestRuntime({ chat: options.model, summarizer: options.model, skills: options.skills })
  const registry = runtime.agent_registry
  if (options.agents === "lead-only") registry.agents.delete("general")
  if (options.patchLead) registry.agents.set("lead", { ...registry.get("lead"), ...options.patchLead })
  await runPrompt({ runtime, agent: "lead", text: "do the thing", format: options.format })
}

function skill(name: string): SkillInfo {
  return { name, description: `${name} workflow`, location: `/skills/${name}/SKILL.md`, content: "body" }
}

describe("prompt assembly", () => {
  it("renders by slot order, not by the order contributors were registered", async () => {
    const { model, systems } = recordingModel()
    const volatileFirst: PromptContributor = () => ({ slot: "volatile", text: "VOLATILE" })
    const conventionSecond: PromptContributor = () => ({ slot: "convention", text: "CONVENTION" })
    const capabilityThird: PromptContributor = () => ({ slot: "capability", text: "CAPABILITY" })

    await run({
      agents: [
        defineHarnessAgent({
          name: "probe",
          mode: "primary",
          model,
          instructions: ["IDENTITY"],
          middleware: [promptAssembly([volatileFirst, conventionSecond, capabilityThird])],
        }),
      ],
    })

    expect(systems[0]).toEqual(["IDENTITY", "CONVENTION", "CAPABILITY", "VOLATILE"])
  })

  it("keeps contribution order within one slot", async () => {
    const { model, systems } = recordingModel()
    const first: PromptContributor = () => ({ slot: "capability", text: "FIRST" })
    const second: PromptContributor = () => ({ slot: "capability", text: "SECOND" })

    await run({
      agents: [
        defineHarnessAgent({
          name: "probe",
          mode: "primary",
          model,
          instructions: [],
          middleware: [promptAssembly([first, second])],
        }),
      ],
    })

    expect(systems[0]).toEqual(["FIRST", "SECOND"])
  })

  it("drops a contributor that has nothing to say this turn", async () => {
    const { model, systems } = recordingModel()
    const silent: PromptContributor = () => undefined

    await run({
      agents: [
        defineHarnessAgent({
          name: "probe",
          mode: "primary",
          model,
          instructions: ["IDENTITY"],
          middleware: [promptAssembly([silent])],
        }),
      ],
    })

    expect(systems[0]).toEqual(["IDENTITY"])
  })

  it("leads with the agent's own identity and states it exactly once", async () => {
    const { model, systems } = recordingModel()
    await runCore({ model })

    expect(systems[0][0]).toStartWith("You are the lead orchestration agent")
    // Regression guard: a shared "You are a general-purpose assistant" preamble
    // used to precede — and contradict — the agent's own role statement.
    expect(systems[0].filter((text) => text.startsWith("You are"))).toHaveLength(1)
  })

  it("renders the volatile slot last so everything above it is a stable prefix", async () => {
    const { model, systems } = recordingModel()
    // steps: 1 makes the first step the final allowed one, so the volatile slot
    // is populated on the very first turn.
    await runCore({ model, patchLead: { steps: 1 }, skills: [skill("demo")], format: JSON_FORMAT })

    const system = systems[0]
    expect(system.at(-1)).toContain("final allowed step")
    expect(system.findIndex((text) => text.includes("<available_skills>"))).toBeLessThan(system.length - 1)
    expect(system.findIndex((text) => text.includes("JSON Schema"))).toBeLessThan(system.length - 1)
  })

  it("lists registered skills, and says nothing when there are none", async () => {
    const withSkills = recordingModel()
    await runCore({ model: withSkills.model, skills: [skill("demo")] })

    const skillsBlock = withSkills.systems[0].find((text) => text.includes("<available_skills>"))
    expect(skillsBlock).toContain("- demo: demo workflow")

    const withoutSkills = recordingModel()
    await runCore({ model: withoutSkills.model })

    expect(withoutSkills.systems[0].some((text) => text.includes("<available_skills>"))).toBe(false)
  })

  it("lists delegable subagents only when some are registered", async () => {
    const withSubagent = recordingModel()
    await runCore({ model: withSubagent.model })

    const block = withSubagent.systems[0].find((text) => text.includes("<available_subagents>"))
    expect(block).toContain("- general:")

    const alone = recordingModel()
    await runCore({ model: alone.model, agents: "lead-only" })

    expect(alone.systems[0].some((text) => text.includes("<available_subagents>"))).toBe(false)
  })

  it("asks for structured output only when the turn requested it", async () => {
    const structured = recordingModel()
    await runCore({ model: structured.model, format: JSON_FORMAT })
    expect(structured.systems[0].some((text) => text.includes("JSON Schema"))).toBe(true)

    const plain = recordingModel()
    await runCore({ model: plain.model })
    expect(plain.systems[0].some((text) => text.includes("JSON Schema"))).toBe(false)
  })

  it("adds continuation guidance only after the first step", async () => {
    // Turn 1 issues a tool call, which keeps the loop going into turn 2.
    const { model, systems } = recordingModel([
      [{ type: "tool-call", toolCallId: "call-1", toolName: "noop", args: {} }, { type: "finish", finishReason: "tool_calls" }],
      DONE,
    ])

    const runtime = createTestRuntime({
      agents: [
        defineHarnessAgent({
          name: "probe",
          mode: "primary",
          model,
          instructions: ["IDENTITY"],
          tools: [NOOP_TOOL],
          steps: 3,
          middleware: baseMiddleware(),
        }),
      ],
    })
    await runPrompt({ runtime, agent: "probe", text: "do the thing" })

    expect(systems).toHaveLength(2)
    expect(systems[0].some((text) => text.startsWith("Continue the existing task"))).toBe(false)
    expect(systems[1].at(-1)).toStartWith("Continue the existing task")
  })

  it("lets an agent's private contributor land in its own slot, not at the end", async () => {
    const { model, systems } = recordingModel()
    const capability: PromptContributor = () => ({ slot: "capability", text: "PRIVATE CAPABILITY" })

    await run({
      agents: [
        defineHarnessAgent({
          name: "probe",
          mode: "primary",
          model,
          instructions: ["IDENTITY"],
          steps: 1,
          // Appended last to the contributor list, yet it must render before the
          // volatile slot — this is the property the whole refactor buys.
          middleware: baseMiddleware([capability]),
        }),
      ],
    })

    const system = systems[0]
    expect(system.indexOf("PRIVATE CAPABILITY")).toBeGreaterThan(0)
    expect(system.indexOf("PRIVATE CAPABILITY")).toBeLessThan(system.length - 1)
    expect(system.at(-1)).toContain("final allowed step")
  })
})

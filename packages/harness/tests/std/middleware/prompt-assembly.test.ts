// The system prompt's shape, asserted end to end: these run a real turn and read
// back the `system` array the model actually received. The behaviour under test
// is ordering, which used to be an emergent property of each agent's middleware
// array and therefore untestable by construction.
import { describe, expect, it } from "bun:test"
import {
  baseMiddleware,
  createCoreAgents,
  createCoreTools,
  createTestRuntime,
  defineAgent,
  defineTool,
  promptAssembly,
  runPrompt,
  type AgentDefinition,
  type PromptContributor,
  type SkillInfo,
} from "@harness"
import type { LLMChunk, Model } from "@harness/llm/types"
import { z } from "zod"
import { createFakeModel } from "../../support/fake-model"

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

async function run(options: { agents: AgentDefinition[]; skills?: SkillInfo[]; format?: typeof JSON_FORMAT }) {
  const runtime = createTestRuntime({
    agents: options.agents,
    skills: options.skills,
    // The core agents declare the core tool set; the registry resolves those names
    // per turn, so they have to be present even for a test that only reads prompts.
    tools: createCoreTools({ visionModel: options.agents[0].model }),
  })
  await runPrompt({ runtime, agent: options.agents[0].name, text: "do the thing", format: options.format })
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
        defineAgent({
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
        defineAgent({
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
        defineAgent({
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
    const [lead] = createCoreAgents({ model, summarizer: model })

    await run({ agents: [lead] })

    expect(systems[0][0]).toStartWith("You are the lead orchestration agent")
    // Regression guard: a shared "You are a general-purpose assistant" preamble
    // used to precede — and contradict — the agent's own role statement.
    expect(systems[0].filter((text) => text.startsWith("You are"))).toHaveLength(1)
  })

  it("renders the volatile slot last so everything above it is a stable prefix", async () => {
    const { model, systems } = recordingModel()
    const [lead] = createCoreAgents({ model, summarizer: model })

    // steps: 1 makes the first step the final allowed one, so the volatile slot
    // is populated on the very first turn.
    await run({ agents: [{ ...lead, steps: 1 }], skills: [skill("demo")], format: JSON_FORMAT })

    const system = systems[0]
    expect(system.at(-1)).toContain("final allowed step")
    expect(system.findIndex((text) => text.includes("<available_skills>"))).toBeLessThan(system.length - 1)
    expect(system.findIndex((text) => text.includes("JSON Schema"))).toBeLessThan(system.length - 1)
  })

  it("lists registered skills, and says nothing when there are none", async () => {
    const withSkills = recordingModel()
    const [leadA] = createCoreAgents({ model: withSkills.model, summarizer: withSkills.model })
    await run({ agents: [leadA], skills: [skill("demo")] })

    const skillsBlock = withSkills.systems[0].find((text) => text.includes("<available_skills>"))
    expect(skillsBlock).toContain("- demo: demo workflow")

    const withoutSkills = recordingModel()
    const [leadB] = createCoreAgents({ model: withoutSkills.model, summarizer: withoutSkills.model })
    await run({ agents: [leadB] })

    expect(withoutSkills.systems[0].some((text) => text.includes("<available_skills>"))).toBe(false)
  })

  it("lists delegable subagents only when some are registered", async () => {
    const withSubagent = recordingModel()
    const pair = createCoreAgents({ model: withSubagent.model, summarizer: withSubagent.model })
    await run({ agents: pair })

    const block = withSubagent.systems[0].find((text) => text.includes("<available_subagents>"))
    expect(block).toContain("- general:")

    const alone = recordingModel()
    const [leadOnly] = createCoreAgents({ model: alone.model, summarizer: alone.model })
    await run({ agents: [leadOnly] })

    expect(alone.systems[0].some((text) => text.includes("<available_subagents>"))).toBe(false)
  })

  it("asks for structured output only when the turn requested it", async () => {
    const structured = recordingModel()
    const [leadA] = createCoreAgents({ model: structured.model, summarizer: structured.model })
    await run({ agents: [leadA], format: JSON_FORMAT })
    expect(structured.systems[0].some((text) => text.includes("JSON Schema"))).toBe(true)

    const plain = recordingModel()
    const [leadB] = createCoreAgents({ model: plain.model, summarizer: plain.model })
    await run({ agents: [leadB] })
    expect(plain.systems[0].some((text) => text.includes("JSON Schema"))).toBe(false)
  })

  it("adds continuation guidance only after the first step", async () => {
    // Turn 1 issues a tool call, which keeps the loop going into turn 2.
    const { model, systems } = recordingModel([
      [{ type: "tool-call", toolCallId: "call-1", toolName: "noop", args: {} }, { type: "finish", finishReason: "tool_calls" }],
      DONE,
    ])

    const runtime = createTestRuntime({
      tools: [NOOP_TOOL],
      agents: [
        defineAgent({
          name: "probe",
          mode: "primary",
          model,
          instructions: ["IDENTITY"],
          tools: { noop: true },
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
        defineAgent({
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

// Local fake provider used for smoke tests and deterministic loop exercises.
import { createStreamingProvider } from "@harness/llm/providers/create"
import type { LLMChunk, LLMInput } from "@harness/llm/types"
import { createID } from "@harness/types"

type FakeState = Record<string, never>

export const fakeStream = createStreamingProvider<never, never, FakeState>({
  name: "Fake",
  createState() {
    return {}
  },
  run: fakeChunkStream,
})

async function* fakeChunkStream(input: LLMInput, _state: FakeState): AsyncGenerator<LLMChunk> {
  void _state
  const userText = latestUserText(input)
  const taskResult = latestToolOutput(input, "task")
  const batchResult = latestToolOutput(input, "batch")
  const invalidGrepError = latestToolError(input, "grep")

  yield {
    type: "reasoning",
    textDelta: `Inspecting request for ${input.agent.name}. `,
  }

  if (userText.includes("invalid args") && invalidGrepError) {
    yield {
      type: "reasoning",
      textDelta: "Observed invalid tool arguments and summarizing the failure. ",
    }
    yield {
      type: "text-delta",
      textDelta: `Handled invalid args for ${input.agent.name}: ${invalidGrepError}`,
    }
    yield { type: "finish", finishReason: "stop" }
    return
  }

  if (userText.includes("invalid args")) {
    yield {
      type: "reasoning",
      textDelta: "Exercising invalid tool arguments. ",
    }
    yield {
      type: "tool-call",
      toolCallId: createID(),
      toolName: "grep",
      args: {},
    }
    yield { type: "finish", finishReason: "tool-calls" }
    return
  }

  if (userText.includes("nested batch") && batchResult) {
    yield {
      type: "reasoning",
      textDelta: "Nested batch finished; summarizing results. ",
    }
    yield {
      type: "text-delta",
      textDelta: `Handled nested batch for ${input.agent.name}: ${batchResult}`,
    }
    yield { type: "finish", finishReason: "stop" }
    return
  }

  if (userText.includes("nested batch")) {
    yield {
      type: "reasoning",
      textDelta: "Executing a nested batch tool call. ",
    }
    yield {
      type: "tool-call",
      toolCallId: createID(),
      toolName: "batch",
      args: {
        tool_calls: [
          {
            tool: "batch",
            parameters: {
              tool_calls: [
                { tool: "grep", parameters: { pattern: "task" } },
                { tool: "read", parameters: { filePath: "packages/harness/src/tool/task.ts" } },
              ],
            },
          },
          {
            tool: "grep",
            parameters: { pattern: "structured-output" },
          },
        ],
      },
    }
    yield { type: "finish", finishReason: "tool-calls" }
    return
  }

  if (userText.includes("@general") && taskResult) {
    yield {
      type: "reasoning",
      textDelta: "Received subagent result and wrapping up. ",
    }
    yield {
      type: "text-delta",
      textDelta: `Handled delegated task for ${input.agent.name}: ${taskResult}`,
    }
    yield { type: "finish", finishReason: "stop" }
    return
  }

  if (userText.includes("@general")) {
    yield {
      type: "reasoning",
      textDelta: "Delegating to a subagent via task. ",
    }
    yield {
      type: "tool-call",
      toolCallId: createID(),
      toolName: "task",
      args: {
        description: "Investigate request",
        prompt: userText.replace("@general", "").trim(),
        subagent_type: "general",
      },
    }
    yield { type: "finish", finishReason: "tool-calls" }
    return
  }

  if (userText.includes("parallel")) {
    yield {
      type: "reasoning",
      textDelta: "Parallelizing independent tool calls with batch. ",
    }
    yield {
      type: "tool-call",
      toolCallId: createID(),
      toolName: "batch",
      args: {
        tool_calls: [
          { tool: "read", parameters: { filePath: "src/session/prompt.ts" } },
          { tool: "grep", parameters: { pattern: "task" } },
        ],
      },
    }
    yield { type: "finish", finishReason: "tool-calls" }
    return
  }

  if (input.user.format?.type === "json_schema") {
    yield {
      type: "reasoning",
      textDelta: "Returning the final answer as structured JSON. ",
    }
    yield {
      type: "text-delta",
      textDelta: JSON.stringify({
        boardId: "unknown",
        title: `Structured response for ${input.agent.name}`,
        abstract: `Synthetic structured report for: ${userText}`,
        chapters: [
          { title: "Overview", body: "Overview generated in fake mode." },
          { title: "Content Analysis", body: "Content analysis generated in fake mode." },
          { title: "Theme and Structure", body: "Theme and structure generated in fake mode." },
          { title: "Risks", body: "Risk analysis generated in fake mode." },
          { title: "Conclusion and Recommendations", body: "Conclusion generated in fake mode." },
        ],
        conclusion: "Fake-mode conclusion.",
        sources: [],
      }),
    }
    yield { type: "finish", finishReason: "stop" }
    return
  }

  const alreadyCompacted = Object.values(input.session.parts).some((parts) =>
    parts.some((part) => part.type === "compaction"),
  )

  if ((userText.includes("overflow") && !alreadyCompacted) || input.session.messages.length >= 8) {
    yield {
      type: "reasoning",
      textDelta: "Context is getting large; requesting compaction. ",
    }
    yield { type: "finish", finishReason: "length" }
    return
  }

  yield {
    type: "reasoning",
    textDelta: "No tool calls required; answering directly. ",
  }
  yield {
    type: "text-delta",
    textDelta: `Handled by ${input.agent.name}: ${userText}`,
  }
  yield { type: "finish", finishReason: "stop" }
}

function latestUserText(input: LLMInput) {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]
    if (message.role !== "user") continue
    return message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
  }

  return ""
}

function latestToolOutput(input: LLMInput, toolName: string) {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]
    if (message.role !== "tool" || message.toolName !== toolName) continue

    const output = message.content.find((block) => block.type === "tool-output")
    if (output?.type === "tool-output") {
      return output.output
    }
  }

  return undefined
}

function latestToolError(input: LLMInput, toolName: string) {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]
    if (message.role !== "tool" || message.toolName !== toolName) continue

    const output = message.content.find((block) => block.type === "tool-error")
    if (output?.type === "tool-error") {
      return output.error
    }
  }

  return undefined
}

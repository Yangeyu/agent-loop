// view_image: the agent-initiated vision path. Unlike user-supplied images
// (which pass through to the multimodal model directly), this tool lets the agent
// inspect an image it encounters mid-task — typically a URL it finds in text, or
// a local path surfaced by another tool. Because the qwen API only allows images
// in user messages (never tool results), this tool does a single-shot qwen3.7-plus
// vision call itself and returns the visual understanding as text. It reuses the
// shared ImageSource resolution (llm/image.ts) so both paths converge on one
// representation and one image_url mapping.
import path from "node:path"
import { resolveImageSource } from "@harness/llm/image"
import type { LLMInput, ModelMessage } from "@harness/llm/types"
import { defineTool } from "@harness/tool/tool"
import {
  createID,
  type AgentInfo,
  type AssistantMessage,
  type ImageSource,
  type ToolContext,
  type UserMessage,
} from "@harness/types"
import { z } from "zod"

const VIEW_MODEL_ID = "qwen3.7-plus"

const VIEW_AGENT: AgentInfo = { name: "view_image", mode: "subagent" }

const VIEW_INSTRUCTIONS = [
  "You are an image understanding assistant. Look at the provided image and answer",
  "the user's request precisely. Report visible text verbatim, describe objects,",
  "layout, and any notable detail. Output only the description.",
].join(" ")

const DEFAULT_PROMPT =
  "Describe this image in detail, including any visible text, objects, and notable content."

const IMAGE_EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
}

export const ViewImageParameters = z.object({
  image: z.string().trim().min(1)
    .describe("A local file path or http(s) URL of an image (JPEG/PNG/WEBP) to look at"),
  prompt: z.string().trim().min(1).optional()
    .describe("What to look for in the image. Defaults to a general description."),
})

export type ViewImageArgs = z.infer<typeof ViewImageParameters>

export const ViewImageTool = defineTool({
  id: "view_image",
  description:
    "Look at an image (local file path or http(s) URL) and return a text description of its contents. Use this to read or understand images, screenshots, or image links.",
  parameters: ViewImageParameters,
  beforeExecute({ args }) {
    return { title: `view_image: ${args.image}` }
  },
  mapError({ args, toolID, error }) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { message: `The ${toolID} tool failed: image not found at ${args.image}`, retryable: false, code: "view_image_not_found" }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { message: `The ${toolID} tool failed: ${message}`, retryable: false, code: "tool_execution_failed" }
  },
  async execute(args, ctx) {
    const source = toImageSource(args.image)
    const description = await describeImage(ctx, source, args.prompt ?? DEFAULT_PROMPT)
    return { title: `view_image: ${args.image}`, output: description }
  },
})

function toImageSource(image: string): ImageSource {
  if (/^https?:\/\//i.test(image)) return { kind: "url", url: image }

  const mime = IMAGE_EXT_MIME[path.extname(image).toLowerCase()]
  if (!mime) {
    throw new Error(`unsupported image type for ${image} (expected JPEG/PNG/WEBP)`)
  }
  return { kind: "file", path: path.resolve(process.cwd(), image), mime }
}

async function describeImage(ctx: ToolContext, source: ImageSource, prompt: string): Promise<string> {
  // Resolve a local file to base64 up front so the provider only ever sees a
  // url/base64 source (file sources are rejected at the image_url mapping).
  const resolved = await resolveImageSource(source)
  const now = Date.now()
  const synthetic = {
    sessionID: ctx.sessionID,
    agent: VIEW_AGENT.name,
    model: { providerID: "dashscope", modelID: VIEW_MODEL_ID },
    time: { created: now },
  }
  const user: UserMessage = { id: createID(), role: "user", ...synthetic }
  const assistant: AssistantMessage = { id: createID(), role: "assistant", parentID: user.id, ...synthetic }

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: [
        { type: "image", source: resolved },
        { type: "text", text: prompt },
      ],
    },
  ]

  const llmInput: LLMInput = {
    session: ctx.session_store.get(ctx.sessionID),
    user,
    assistant,
    agent: VIEW_AGENT,
    system: [VIEW_INSTRUCTIONS],
    messages,
    tools: [],
    abort: ctx.abort,
  }

  let text = ""
  for await (const chunk of ctx.model_provider(llmInput).fullStream) {
    if (chunk.type === "text-delta") text += chunk.textDelta
    else if (chunk.type === "error") {
      throw new Error(typeof chunk.error === "string" ? chunk.error : "vision model call failed")
    }
  }

  const description = text.trim()
  if (!description) throw new Error("vision model returned an empty description")
  return description
}

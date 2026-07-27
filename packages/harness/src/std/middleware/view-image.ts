// Resolves user-supplied image inputs into a provider-ready form just before the
// turn is sent. This is the IO stage of the passthrough path: toModelMessages
// emits image blocks with their raw source (kept pure/sync), and this middleware
// reads local `file` sources off disk and base64-encodes them. `base64` (pasted
// screenshots) and `url` sources pass through untouched. Runs inside the
// beforeModelCall fold (messages -> messages, no store writes), so it does not
// break fold purity.
import { resolveImageSource } from "@harness/llm/image"
import type { ModelContentBlock, ModelMessage } from "@harness/llm/types"
import type { MiddlewareFactory } from "@harness/agent/hooks"

export const viewImage: MiddlewareFactory = () => ({
  name: "view-image",

  async beforeModelCall(ctx, draft) {
    if (!ctx.model.spec.capabilities.vision) return draft
    return { ...draft, messages: await Promise.all(draft.messages.map(resolveMessageImages)) }
  },
})

async function resolveMessageImages(message: ModelMessage): Promise<ModelMessage> {
  const content = await resolveBlocks(message.content)
  if (content === message.content) return message
  return { ...message, content } as ModelMessage
}

async function resolveBlocks(blocks: ModelContentBlock[]): Promise<ModelContentBlock[]> {
  let changed = false
  const resolved = await Promise.all(
    blocks.map(async (block) => {
      if (block.type !== "image" || block.source.kind !== "file") return block
      changed = true
      return { ...block, source: await resolveImageSource(block.source) }
    }),
  )
  return changed ? resolved : blocks
}

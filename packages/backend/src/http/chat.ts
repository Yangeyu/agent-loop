import type { RuntimeContext } from "@harness/runtime/context"
import type { RuntimeEvent } from "@harness/runtime/events"
import { SessionPrompt } from "@harness/session/prompt"
import { corsHeaders, jsonResponse } from "@backend/http/responses"
import { z } from "zod"

const encoder = new TextEncoder()

const PromptRequestSchema = z.object({
  text: z.string().trim().min(1),
  agent: z.string().trim().min(1).optional(),
  sessionID: z.string().trim().min(1).optional(),
})

function serializeSSEData(data: unknown) {
  const seen = new WeakSet<object>()

  return JSON.stringify(data, (_key, value) => {
    if (typeof value === "bigint") return value.toString()

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }

    return value
  })
}

function toSingleLine(value: string, maxLength = 500) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function logOutgoingSSE(event: string, payload: string) {
  console.log(`[sse] ${event} ${toSingleLine(payload)}`)
}

function createStreamWriter(controller: ReadableStreamDefaultController<Uint8Array>) {
  let closed = false

  return {
    send(event: string, data: unknown) {
      if (closed) return false

      try {
        const payload = serializeSSEData(data)
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${payload}\n\n`))
        logOutgoingSSE(event, payload)
        return true
      } catch {
        closed = true
        return false
      }
    },

    comment(text: string) {
      if (closed) return false

      try {
        controller.enqueue(encoder.encode(`: ${text}\n\n`))
        logOutgoingSSE("comment", text)
        return true
      } catch {
        closed = true
        return false
      }
    },

    close() {
      if (closed) return
      closed = true

      try {
        controller.close()
      } catch {
        // Ignore close failures after the client disconnects.
      }
    },

    cancel() {
      closed = true
    },
  }
}

function belongsToSessionTree(runtime: RuntimeContext, sessionID: string, rootSessionID: string) {
  let currentID: string | undefined = sessionID

  while (currentID) {
    if (currentID === rootSessionID) return true

    try {
      currentID = runtime.session_store.get(currentID).parentID
    } catch {
      return false
    }
  }

  return false
}

function createEventForwarder(input: {
  runtime: RuntimeContext
  rootSessionID: string
  writer: ReturnType<typeof createStreamWriter>
}) {
  const textStarted = new Set<string>()

  return (event: RuntimeEvent) => {
    if (!belongsToSessionTree(input.runtime, event.sessionID, input.rootSessionID)) return

    if (event.type === "turn-start") {
      input.writer.send("message-metadata", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        agent: event.agent,
        step: event.step,
      })
      return
    }

    if (event.type === "reasoning") {
      input.writer.send("reasoning-delta", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        delta: event.textDelta,
      })
      return
    }

    if (event.type === "text") {
      if (!textStarted.has(event.turnID)) {
        textStarted.add(event.turnID)
        input.writer.send("text-start", {
          sessionID: event.sessionID,
          messageID: event.messageID,
          turnID: event.turnID,
        })
      }

      input.writer.send("text-delta", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        delta: event.textDelta,
      })
      return
    }

    if (event.type === "tool-call") {
      input.writer.send("tool-call", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        toolCall: {
          toolCallId: event.toolCallId,
          toolName: event.tool,
          args: event.args,
        },
      })
      return
    }

    if (event.type === "tool-metadata") {
      input.writer.send("tool-call", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        toolCall: {
          toolCallId: event.toolCallId,
          toolName: event.tool,
          title: event.title,
          metadata: event.metadata,
        },
      })
      return
    }

    if (event.type === "tool-result") {
      input.writer.send("tool-result", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        toolResult: {
          toolCallId: event.toolCallId,
          toolName: event.tool,
          output: event.output,
          title: event.title,
          metadata: event.metadata,
          attachments: event.attachments,
        },
      })
      return
    }

    if (event.type === "tool-error") {
      input.writer.send("tool-result", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        toolResult: {
          toolCallId: event.toolCallId,
          toolName: event.tool,
          error: event.errorInfo ?? {
            message: event.error,
          },
        },
      })
      return
    }

    if (event.type === "finish") {
      input.writer.send("finish", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        finishReason: event.finishReason,
      })
      return
    }

    if (event.type === "error") {
      input.writer.send("error", {
        sessionID: event.sessionID,
        messageID: event.messageID,
        turnID: event.turnID,
        error: event.error,
      })
    }
  }
}

export async function handleChatRequest(request: Request, runtime: RuntimeContext) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = PromptRequestSchema.safeParse(payload)
  if (!parsed.success) {
    return jsonResponse({
      error: "Invalid request body",
      issues: parsed.error.issues,
    }, { status: 400 })
  }

  let rootSession

  try {
    rootSession = parsed.data.sessionID
      ? runtime.session_store.get(parsed.data.sessionID)
      : runtime.session_store.create({ title: "SSE session" })
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : String(error),
    }, { status: 404 })
  }

  const agent = parsed.data.agent ?? runtime.agent_registry.defaultAgent().name

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const abortController = new AbortController()
      const writer = createStreamWriter(controller)
      let cleanedUp = false

      // Periodically send a keep-alive comment to prevent connection timeouts
      // during long-running tool executions or reasoning phases.
      const heartbeat = setInterval(() => {
        if (!writer.comment("keep-alive")) {
          cleanup({ abortPrompt: true })
        }
      }, 15000)

      const unsubscribe = runtime.events.subscribe(createEventForwarder({
        runtime,
        rootSessionID: rootSession.id,
        writer,
      }))

      const cleanup = (options?: { abortPrompt?: boolean; closeStream?: boolean }) => {
        if (cleanedUp) return
        cleanedUp = true

        if (options?.abortPrompt && !abortController.signal.aborted) {
          abortController.abort()
        }

        clearInterval(heartbeat)
        unsubscribe()

        if (options?.closeStream) {
          writer.close()
          return
        }

        writer.cancel()
      }

      request.signal.addEventListener("abort", () => {
        cleanup({ abortPrompt: true })
      }, { once: true })

      if (!writer.send("session-metadata", {
        sessionID: rootSession.id,
        agent,
      })) {
        cleanup({ abortPrompt: true })
        return
      }

      void SessionPrompt.prompt({
        sessionID: rootSession.id,
        text: parsed.data.text,
        agent,
        abort: abortController.signal,
      }, runtime).then(() => {
        const sent = writer.send("done", {
          sessionID: rootSession.id,
        })

        cleanup({ closeStream: sent })
      }).catch((error: unknown) => {
        if (abortController.signal.aborted) return

        const sent = writer.send("error", {
          sessionID: rootSession.id,
          error: error instanceof Error ? error.message : String(error),
        })

        cleanup({ closeStream: sent })
      })
    },
    cancel() {
      return
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  })
}

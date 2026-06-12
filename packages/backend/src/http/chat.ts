// SSE chat endpoint. The wire protocol *is* the harness event vocabulary
// (contracts StateEvent / LoopEvent), so forwarding is a rootID filter plus a
// verbatim passthrough — no translation layer. Consumers reconstruct session
// state with the shared `applyStateEvent` reducer from @agent-loop/contracts.
import { runSession, type LoopEvent, type RuntimeContext, type StateEvent } from "@harness"
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
      ? runtime.sessions.get(parsed.data.sessionID)
      : runtime.sessions.create({ title: "SSE session" })
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

      // Every event carries its delegation tree's rootID, so scoping to this
      // request is a constant-time comparison — no parent-chain walking.
      const rootID = rootSession.rootID
      const forwardState = (event: StateEvent) => {
        if (event.rootID !== rootID) return
        writer.send("state", event)
      }
      const forwardLoop = (event: LoopEvent) => {
        if (event.rootID !== rootID) return
        writer.send("loop", event)
      }

      const unsubscribeState = runtime.events.state.subscribe(forwardState)
      const unsubscribeLoop = runtime.events.loop.subscribe(forwardLoop)

      const cleanup = (options?: { abortPrompt?: boolean; closeStream?: boolean }) => {
        if (cleanedUp) return
        cleanedUp = true

        if (options?.abortPrompt && !abortController.signal.aborted) {
          abortController.abort()
        }

        clearInterval(heartbeat)
        unsubscribeState()
        unsubscribeLoop()

        if (options?.closeStream) {
          writer.close()
          return
        }

        writer.cancel()
      }

      request.signal.addEventListener("abort", () => {
        cleanup({ abortPrompt: true })
      }, { once: true })

      void runSession(runtime, {
        sessionID: rootSession.id,
        text: parsed.data.text,
        agent,
        abort: abortController.signal,
      }).then(() => {
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

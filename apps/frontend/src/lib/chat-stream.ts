import type { StreamEvent } from "../types"

const decoder = new TextDecoder()

function parseFrame(frame: string): StreamEvent | null {
  const lines = frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)

  let eventName = ""
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim()
      continue
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim())
    }
  }

  if (!eventName || dataLines.length === 0) return null

  return {
    event: eventName,
    data: JSON.parse(dataLines.join("\n")),
  } as StreamEvent
}

async function* readFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const boundary = buffer.indexOf("\n\n")
        if (boundary === -1) break

        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (frame.trim()) yield frame
      }
    }

    buffer += decoder.decode()
    if (buffer.trim()) yield buffer
  } finally {
    reader.releaseLock()
  }
}

export async function consumeChatStream(input: {
  apiBaseUrl: string
  text: string
  agent?: string
  sessionID?: string
  signal: AbortSignal
  onEvent: (event: StreamEvent) => void
}) {
  const response = await fetch(`${input.apiBaseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      agent: input.agent || undefined,
      sessionID: input.sessionID || undefined,
    }),
    signal: input.signal,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (!response.body) {
    throw new Error("SSE response did not include a body")
  }

  for await (const frame of readFrames(response.body)) {
    const event = parseFrame(frame)
    if (event) input.onEvent(event)
  }
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>, abort: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      abort.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      for (const event of splitSSEEvents(buffer)) {
        if (event.kind === "data") {
          yield event.value
        } else {
          buffer = event.value
        }
      }
    }

    const tail = parseSSEDataBlock(buffer.trim())
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}

function splitSSEEvents(buffer: string) {
  const results: Array<{ kind: "data" | "rest"; value: string }> = []
  let rest = buffer
  let boundary = rest.indexOf("\n\n")

  while (boundary !== -1) {
    const rawEvent = rest.slice(0, boundary)
    rest = rest.slice(boundary + 2)
    const data = parseSSEDataBlock(rawEvent)
    if (data) {
      results.push({ kind: "data", value: data })
    }
    boundary = rest.indexOf("\n\n")
  }

  results.push({ kind: "rest", value: rest })
  return results
}

function parseSSEDataBlock(block: string) {
  if (!block) return ""
  return block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
}

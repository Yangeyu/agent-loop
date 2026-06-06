// Shared provider execution skeleton for local and remote streaming models.
import { parseSSE } from "@harness/llm/providers/sse"
import type { LLMChunk, LLMInput, LLMStreamResult } from "@harness/llm/types"

export type ProviderRequest<TRequestBody> = {
  url: string
  apiKey: string
  headers?: Record<string, string>
  body: TRequestBody
}

export type RemoteStreamingProviderAdapter<TRequestBody, TPayload, TState> = {
  name: string
  buildRequest(input: LLMInput): ProviderRequest<TRequestBody>
  createState(): TState
  parsePayload(rawPayload: string): TPayload
  mapPayload(payload: TPayload, state: TState): LLMChunk[]
  flush(state: TState): LLMChunk[]
}

export type LocalStreamingProviderAdapter<TState> = {
  name: string
  createState(): TState
  run(input: LLMInput, state: TState): AsyncIterable<LLMChunk>
  flush?(state: TState): LLMChunk[]
}

type StreamingProviderAdapter<TRequestBody, TPayload, TState> =
  | RemoteStreamingProviderAdapter<TRequestBody, TPayload, TState>
  | LocalStreamingProviderAdapter<TState>

export function createStreamingProvider<TRequestBody, TPayload, TState>(
  adapter: StreamingProviderAdapter<TRequestBody, TPayload, TState>,
) {
  return function streamText(input: LLMInput): LLMStreamResult {
    return {
      fullStream: runProviderStream(input, adapter),
    }
  }
}

async function* runProviderStream<TRequestBody, TPayload, TState>(
  input: LLMInput,
  adapter: StreamingProviderAdapter<TRequestBody, TPayload, TState>,
): AsyncGenerator<LLMChunk> {
  const state = adapter.createState()

  try {
    if ("run" in adapter) {
      yield* adapter.run(input, state)
      yield* (adapter.flush?.(state) ?? [])
      return
    }

    yield* runRemoteProviderStream(input, adapter, state)
  } catch (error) {
    yield {
      type: "error",
      error,
    }
  }
}

async function* runRemoteProviderStream<TRequestBody, TPayload, TState>(
  input: LLMInput,
  adapter: RemoteStreamingProviderAdapter<TRequestBody, TPayload, TState>,
  state: TState,
): AsyncGenerator<LLMChunk> {
  const response = await requestStream(input, adapter)
  const body = response.body
  if (!body) {
    throw new Error(`${adapter.name} response did not include a body`)
  }

  for await (const rawPayload of parseSSE(body, input.abort)) {
    if (rawPayload === "[DONE]") break
    const payload = adapter.parsePayload(rawPayload)
    yield* adapter.mapPayload(payload, state)
  }

  yield* adapter.flush(state)
}

async function requestStream<TRequestBody, TPayload, TState>(
  input: LLMInput,
  adapter: RemoteStreamingProviderAdapter<TRequestBody, TPayload, TState>,
) {
  const request = adapter.buildRequest(input)
  const response = await fetch(request.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      ...request.headers,
    },
    signal: input.abort,
    body: JSON.stringify(request.body),
  })

  if (!response.ok) {
    throw new Error(`${adapter.name} request failed (${response.status}): ${await response.text()}`)
  }

  return response
}

import type { ErrorInfo } from "@harness/types"
import type { RetryPolicy } from "@harness/session/execution-policy"

export const DOOM_LOOP_THRESHOLD = 3

type RetryInput<T> = {
  abort: AbortSignal
  maxRetries: number
  shouldRetry(error: unknown, attempt: number): boolean
  getDelay(attempt: number): number
  onRetry?(error: unknown, attempt: number): Promise<void> | void
  run(): Promise<T>
}

export type RetryCategory =
  | "abort"
  | "timeout"
  | "network"
  | "availability"
  | "rate_limit"
  | "unknown"

export type RetryClassification = {
  retryable: boolean
  category: RetryCategory
  reason?: string
}

const RETRY_RULES: Array<{ pattern: string; category: Exclude<RetryCategory, "abort" | "unknown"> }> = [
  { pattern: "timeout", category: "timeout" },
  { pattern: "timed out", category: "timeout" },
  { pattern: "econnreset", category: "network" },
  { pattern: "socket hang up", category: "network" },
  { pattern: "temporarily unavailable", category: "availability" },
  { pattern: "502", category: "availability" },
  { pattern: "503", category: "availability" },
  { pattern: "504", category: "availability" },
  { pattern: "rate limit", category: "rate_limit" },
]

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
}

export function classifyRetry(error: unknown): RetryClassification {
  if (isAbortError(error)) {
    return {
      retryable: false,
      category: "abort",
      reason: "abort signal received",
    }
  }

  const message = errorMessage(error)
  const match = RETRY_RULES.find((rule) => message.includes(rule.pattern))

  if (!match) {
    return {
      retryable: false,
      category: "unknown",
    }
  }

  return {
    retryable: true,
    category: match.category,
    reason: match.pattern,
  }
}

export function isRetryableError(error: unknown): boolean {
  return classifyRetry(error).retryable
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  )
}

export function toErrorInfo(error: unknown, retryable: boolean): ErrorInfo {
  if (error instanceof Error) {
    return {
      message: error.message,
      retryable,
      code: error.name,
    }
  }

  return {
    message: String(error),
    retryable,
  }
}

export function retryDelay(attempt: number, policy: RetryPolicy): number {
  return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs)
}

export async function sleep(ms: number, abort: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      abort.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timeout)
      reject(new DOMException("Aborted", "AbortError"))
    }

    abort.addEventListener("abort", onAbort, { once: true })
  })
}

export async function retry<T>(input: RetryInput<T>): Promise<T> {
  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    try {
      return await input.run()
    } catch (error) {
      const canRetry = attempt < input.maxRetries && input.shouldRetry(error, attempt)
      if (!canRetry) throw error

      const nextAttempt = attempt + 1
      await input.onRetry?.(error, nextAttempt)
      await sleep(input.getDelay(nextAttempt), input.abort)
    }
  }

  throw new Error("Retry attempts exhausted")
}

export function isDoomLoop(
  history: Array<{ toolName: string; args: unknown }>,
  toolName: string,
  args: unknown,
): boolean {
  const recent = history.slice(-(DOOM_LOOP_THRESHOLD - 1))
  return (
    recent.length === DOOM_LOOP_THRESHOLD - 1 &&
    recent.every(
      (item) => item.toolName === toolName && JSON.stringify(item.args) === JSON.stringify(args),
    )
  )
}

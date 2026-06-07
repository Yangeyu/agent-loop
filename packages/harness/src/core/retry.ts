/**
 * Error classification + the generic retry driver shared by the turn loop.
 * classifyRetry decides what is retryable; retry() runs an operation with
 * exponential backoff and abort support.
 */
import type { ErrorInfo } from "@harness/types"
import type { RetryPolicy } from "@harness/core/policy"

type RetryInput<T> = {
  abort: AbortSignal
  maxRetries: number
  shouldRetry(error: unknown, attempt: number): boolean
  getDelay(attempt: number): number
  onRetry?(error: unknown, attempt: number): Promise<void> | void
  run(): Promise<T>
}

/** The bucket an error falls into for retry/telemetry purposes. */
export type RetryCategory =
  | "abort"
  | "timeout"
  | "network"
  | "availability"
  | "rate_limit"
  | "unknown"

/** The verdict for an error: whether to retry, its category, and a brief reason. */
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

/**
 * Classifies an error into a retry verdict by matching its message against known
 * transient patterns; aborts are never retryable.
 *
 * @param error - the thrown error
 * @returns whether it is retryable, its category, and a reason
 */
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

/**
 * Whether an error is an abort (DOMException/Error named "AbortError").
 *
 * @param error - the thrown error
 * @returns true if it represents an abort
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  )
}

/**
 * Normalizes any thrown value into the structured ErrorInfo stored on a part.
 *
 * @param error - the thrown value
 * @param retryable - the retryable flag to record (from classification)
 * @returns the structured error info
 */
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

/**
 * Exponential backoff delay for an attempt, capped at the policy's max.
 *
 * @param attempt - the 1-based retry attempt number
 * @param policy - the retry policy (base/max delays)
 * @returns the delay in milliseconds
 */
export function retryDelay(attempt: number, policy: RetryPolicy): number {
  return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs)
}

function sleep(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

/**
 * Runs an operation with retries: on failure, consults shouldRetry, invokes the
 * optional onRetry, sleeps for getDelay, and tries again until maxRetries.
 *
 * @param input - the operation plus retry policy callbacks and abort signal
 * @returns the operation's resolved value
 * @throws the last error if retries are exhausted or shouldRetry returns false
 */
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

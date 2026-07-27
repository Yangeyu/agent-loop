/**
 * Failure classification for the model port: whether a provider error is worth
 * another attempt, and how any thrown value becomes the ErrorInfo stored on a
 * part. Anyone wrapping a model call needs this; the retry *policy* built on it
 * is a middleware (std/middleware/retry.ts).
 */
import type { ErrorInfo } from "@harness/types"

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

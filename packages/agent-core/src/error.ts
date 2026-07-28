/**
 * Normalizing a thrown value: what the loop needs to tell an abort from a
 * failure, and to store either one on a part.
 */
import type { ErrorInfo } from "@agent-core/types"

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

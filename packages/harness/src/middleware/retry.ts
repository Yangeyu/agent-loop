/**
 * Model-call retry. The loop supplies the seam (wrapModelCall) and the failure
 * classification; the backoff policy is replaceable behaviour and belongs here.
 *
 * The attempt counter lives in one wrapModelCall invocation's closure, so it
 * resets per step without anyone resetting it. Reporting each attempt through
 * ctx.activity is what makes a 4-second backoff distinguishable from a hang.
 */
import { classifyRetry } from "@agent-core"
import type { MiddlewareFactory } from "@agent-core"
import { RETRY_DEFAULTS } from "@harness/config"

/** Exponential-backoff bounds for a step's model call. */
export type RetryOptions = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
}

/**
 * Builds the retry middleware.
 *
 * @param options - retry count and backoff bounds; defaults match the config's
 * @returns the middleware factory
 */
export function createRetry(options: RetryOptions = RETRY_DEFAULTS): MiddlewareFactory {
  return () => ({
    name: "retry",

    async wrapModelCall(ctx, request, next) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await next(request)
        } catch (error) {
          if (attempt >= options.maxRetries || !classifyRetry(error).retryable) throw error

          const activity = ctx.activity({
            label: "retrying model call",
            detail: `attempt ${attempt + 1} of ${options.maxRetries}`,
          })
          try {
            await sleep(backoff(attempt + 1, options), ctx.abort)
          } finally {
            activity.end()
          }
        }
      }
    },
  })
}

function backoff(attempt: number, options: RetryOptions) {
  return Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs)
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

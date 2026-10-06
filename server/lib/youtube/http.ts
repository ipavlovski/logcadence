// Requests to YouTube with retries: a network error, 429 or 5xx (or a rate-limit answer) is tried again with backoff,
// so one blip among the hundreds of requests of a large playlist doesn't fail the import.

/** Thrown by an attempt that may succeed when tried again. */
export class RetryableError extends Error {
  constructor(
    message: string,
    /** Seconds the server asked to wait (Retry-After). */
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

// Waits before the 2nd, 3rd and 4th attempt; tests set them to 0.
export const retry = { delaysMs: [1000, 4000, 15000] }

/** Runs `attempt` until it succeeds, throws something not retryable, or the retries are used up (the last error is thrown). */
export async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt()
    } catch (err) {
      const retryable = err instanceof RetryableError || isNetworkError(err)
      if (!retryable || i >= retry.delaysMs.length) throw err
      const asked = err instanceof RetryableError && err.retryAfter ? Math.min(err.retryAfter, 60) * 1000 : 0
      await new Promise((r) => setTimeout(r, Math.max(asked, retry.delaysMs[i]!)))
    }
  }
}

/** fetch's own failures (DNS, reset connection, timeout), as opposed to an answer. */
const isNetworkError = (err: unknown) => err instanceof TypeError || (err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(err.message))

export const isRetryableStatus = (status: number) => status === 429 || status >= 500

export const retryAfter = (res: Response) => {
  const s = Number(res.headers.get('retry-after'))
  return Number.isFinite(s) && s > 0 ? s : undefined
}

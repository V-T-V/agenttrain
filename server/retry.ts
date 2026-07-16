// 指数退避重试（搬自 agentresearch/src/utils/retry.ts，去掉 logger 依赖保持零依赖）。

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: unknown, attempt: number) => boolean;
}

function backoff(attempt: number, base: number, max: number): number {
  const exp = base * 2 ** attempt;
  const jitter = Math.random() * base;
  return Math.min(exp + jitter, max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const retryOn = options.retryOn ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastError = e;
      if (attempt >= retries || !retryOn(e, attempt)) {
        throw e;
      }
      const wait = backoff(attempt, baseDelayMs, maxDelayMs);
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[retry] 第 ${attempt + 1} 次失败（${msg}），${Math.round(wait)}ms 后重试…`);
      await sleep(wait);
    }
  }
  throw lastError;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

import { requestError } from './requestErrors';

// Share a small download pool across jobs. Hold a slot until the body is read,
// but release it during backoff so other completed jobs can make progress.
let active = 0;
const waiting = [];
async function limited(task) {
  if (active >= 3) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try { return await task(); }
  finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
const transient = new Set([408, 429, 500, 502, 503, 504]);
export class ResultRequestError extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}
export function retryDelay(response, attempt, now = Date.now()) {
  const header = response?.headers?.get('Retry-After');
  const seconds = header && /^\d+$/.test(header.trim()) ? Number(header) : NaN;
  const date = header ? Date.parse(header) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : date - now;
  return Math.max(Math.min(30000, 1000 * 2 ** attempt), Number.isFinite(requested) ? Math.max(0, requested) : 0);
}

// Only idempotent reads are retried. Submission and cancellation never use this.
export async function resultRequest(url, type = 'json') {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      return await limited(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          response = await fetch(url, {signal: controller.signal});
          if (!response.ok) {
            throw new ResultRequestError(
              await requestError(response, 'Compute results retrieval failed'),
              transient.has(response.status),
            );
          }
          return await response[type]();
        } finally { clearTimeout(timeout); }
      });
    } catch (error) {
      // Fetch and interrupted body transfers raise TypeError; malformed output
      // and authorization failures need attention, not an endless retry loop.
      const retryable = error.retryable || error instanceof TypeError || error.name === 'AbortError';
      if (!retryable || attempt >= 5) {
        throw new ResultRequestError(error.message || String(error), retryable);
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay(response, attempt)));
    }
  }
}

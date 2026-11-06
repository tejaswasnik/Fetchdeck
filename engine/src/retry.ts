import { HttpStatusError, RangeIgnoredError, ShortSegmentError } from './errors';

export type Failure =
  | { kind: 'network' }
  | { kind: 'server'; retryAfterMs: number | null }
  | { kind: 'linkExpired' }
  | { kind: 'permanent'; status: number }
  | { kind: 'rangeIgnored' }
  | { kind: 'diskFull' }
  | { kind: 'aborted' }
  | { kind: 'fatal'; message: string };

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET']);
const DISK_CODES = new Set(['ENOSPC', 'EDQUOT', 'EROFS']);
const PERMANENT_STATUSES = new Set([400, 401, 404, 405, 451]);

// Node's fetch hides the real network code inside err.cause.
const errorCode = (err: unknown): string | undefined => {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
};

export const classifyFailure = (err: unknown): Failure => {
  if (err instanceof Error && err.name === 'AbortError') return { kind: 'aborted' };
  if (err instanceof HttpStatusError) {
    const { status } = err;
    if (status >= 500 || status === 429) return { kind: 'server', retryAfterMs: err.retryAfterMs };
    if (status === 403 || status === 410) return { kind: 'linkExpired' };
    if (PERMANENT_STATUSES.has(status)) return { kind: 'permanent', status };
    return { kind: 'fatal', message: err.message };
  }
  if (err instanceof RangeIgnoredError) return { kind: 'rangeIgnored' };
  const code = errorCode(err);
  if (code && DISK_CODES.has(code)) return { kind: 'diskFull' };
  if (err instanceof ShortSegmentError) return { kind: 'network' };
  if (code && NETWORK_CODES.has(code)) return { kind: 'network' };
  if (err instanceof TypeError && err.message === 'fetch failed') return { kind: 'network' };
  return { kind: 'fatal', message: err instanceof Error ? err.message : String(err) };
};

export const backoffMs = (attempt: number): number => Math.min(30_000, 1000 * 2 ** (Math.max(1, attempt) - 1));

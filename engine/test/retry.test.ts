import { describe, expect, it } from 'vitest';
import { HttpStatusError, RangeIgnoredError, ShortSegmentError } from '../src/errors';
import { backoffMs, classifyFailure } from '../src/retry';

const coded = (code: string) => Object.assign(new Error('x'), { code });

describe('classifyFailure', () => {
  it('5xx and 429 are server', () => {
    expect(classifyFailure(new HttpStatusError(503, 2000))).toEqual({ kind: 'server', retryAfterMs: 2000 });
    expect(classifyFailure(new HttpStatusError(429))).toEqual({ kind: 'server', retryAfterMs: null });
  });
  it('403 and 410 are linkExpired', () => {
    expect(classifyFailure(new HttpStatusError(403))).toEqual({ kind: 'linkExpired' });
    expect(classifyFailure(new HttpStatusError(410))).toEqual({ kind: 'linkExpired' });
  });
  it.each([400, 401, 404, 405, 451])('%i is permanent', (status) => {
    expect(classifyFailure(new HttpStatusError(status))).toEqual({ kind: 'permanent', status });
  });
  it('RangeIgnoredError', () => expect(classifyFailure(new RangeIgnoredError())).toEqual({ kind: 'rangeIgnored' }));
  it('network cases', () => {
    expect(classifyFailure(new ShortSegmentError())).toEqual({ kind: 'network' });
    expect(classifyFailure(new TypeError('fetch failed'))).toEqual({ kind: 'network' });
    for (const c of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET']) {
      expect(classifyFailure(coded(c))).toEqual({ kind: 'network' });
    }
  });
  it('reads codes from err.cause', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    expect(classifyFailure(err)).toEqual({ kind: 'network' });
  });
  it('disk full codes', () => {
    for (const c of ['ENOSPC', 'EDQUOT', 'EROFS']) expect(classifyFailure(coded(c))).toEqual({ kind: 'diskFull' });
  });
  it('AbortError is aborted', () => {
    expect(classifyFailure(new DOMException('x', 'AbortError'))).toEqual({ kind: 'aborted' });
  });
  it('anything else is fatal', () => {
    expect(classifyFailure(new Error('boom'))).toEqual({ kind: 'fatal', message: 'boom' });
  });
});

describe('backoffMs', () => {
  it('doubles up to 30000', () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
    expect(backoffMs(10)).toBe(30000);
  });
});

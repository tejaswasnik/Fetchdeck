import { HttpStatusError, InvalidUrlError } from './errors';
import { chooseFilename } from './filename';
import { headerRecord, type RequestHeaders } from './headers';
import type { ProbeResult } from './types';

export const assertHttpUrl = (url: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidUrlError(`Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidUrlError(`Only http and https links are supported: ${url}`);
  }
};

export const parseRetryAfterMs = (header: string | null): number | null => {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

const totalFromContentRange = (header: string | null): number | null => {
  const total = header?.split('/')[1];
  if (total === undefined || total === '*') return null;
  const n = Number(total);
  return Number.isFinite(n) ? n : null;
};

export const probe = async (url: string, signal?: AbortSignal, headers?: RequestHeaders): Promise<ProbeResult> => {
  assertHttpUrl(url);
  const res = await fetch(url, {
    headers: { ...headerRecord(headers), Range: 'bytes=0-0', 'Accept-Encoding': 'identity' },
    signal,
  });
  // Only the headers matter; cancel the body so the connection is released.
  await res.body?.cancel();

  const header = (name: string): string | null => res.headers.get(name);
  const base = {
    finalUrl: res.url,
    filename: chooseFilename(header('content-disposition'), res.url, url),
    etag: header('etag'),
    lastModified: header('last-modified'),
  };

  if (res.status === 206) {
    return { ...base, size: totalFromContentRange(header('content-range')), rangeSupported: true };
  }
  if (res.status === 200) {
    const length = header('content-length');
    return { ...base, size: length === null ? null : Number(length), rangeSupported: false };
  }
  if (res.status === 416 && totalFromContentRange(header('content-range')) === 0) {
    return { ...base, size: 0, rangeSupported: false };
  }
  throw new HttpStatusError(res.status, parseRetryAfterMs(header('retry-after')));
};

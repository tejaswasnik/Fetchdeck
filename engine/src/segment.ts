import { HttpStatusError, RangeIgnoredError, ShortSegmentError } from './errors';
import { headerRecord, type RequestHeaders } from './headers';
import { parseRetryAfterMs } from './probe';
import type { SegmentState } from './types';

export type SegmentOptions = {
  url: string;
  headers?: RequestHeaders; // credentials for this request; the engine's own headers always win
  segment: SegmentState;
  etag: string | null;
  signal: AbortSignal;
  writeAt: (data: Uint8Array, position: number) => Promise<void>;
  onBytes: (count: number) => void;
};

// Bytes still wanted. Re-read every chunk: work stealing shortens segment.end while this runs.
const wanted = (s: SegmentState): number => s.end - (s.start + s.downloaded) + 1;

export const runSegment = async ({ url, headers: extra, segment, etag, signal, writeAt, onBytes }: SegmentOptions): Promise<void> => {
  if (wanted(segment) <= 0) return;

  const headers: Record<string, string> = {
    ...headerRecord(extra),
    Range: `bytes=${segment.start + segment.downloaded}-${segment.end}`,
    'Accept-Encoding': 'identity',
  };
  if (etag) headers['If-Range'] = etag;

  const res = await fetch(url, { headers, signal });
  if (res.status === 200) {
    await res.body?.cancel();
    throw new RangeIgnoredError();
  }
  if (res.status !== 206 || !res.body) {
    await res.body?.cancel();
    throw new HttpStatusError(res.status, parseRetryAfterMs(res.headers.get('retry-after')));
  }

  const reader = res.body.getReader();
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err) {
        if (signal.aborted) throw err;
        throw new ShortSegmentError('Connection dropped mid-segment', { cause: err });
      }
      if (result.done) throw new ShortSegmentError();

      const room = wanted(segment);
      if (room <= 0) return;
      const chunk = result.value.length > room ? result.value.subarray(0, room) : result.value;
      await writeAt(chunk, segment.start + segment.downloaded);
      segment.downloaded += chunk.length;
      onBytes(chunk.length);
      if (wanted(segment) <= 0) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

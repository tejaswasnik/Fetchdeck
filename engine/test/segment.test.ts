import { afterEach, describe, expect, it } from 'vitest';
import { RangeIgnoredError, ShortSegmentError } from '../src/errors';
import { runSegment } from '../src/segment';
import type { SegmentState } from '../src/types';
import { startFakeServer, type FakeServer } from './helpers/fakeServer';

let server: FakeServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const harness = (size: number) => {
  const file = Buffer.alloc(size);
  const writes: number[] = [];
  return {
    file,
    writes,
    writeAt: async (data: Uint8Array, position: number) => {
      file.set(data, position);
      writes.push(data.length);
    },
  };
};

const run = (url: string, segment: SegmentState, h: ReturnType<typeof harness>, signal = new AbortController().signal) =>
  runSegment({ url: `${url}/file`, segment, etag: null, signal, writeAt: h.writeAt, onBytes: () => undefined });

describe('runSegment', () => {
  it('downloads a range into the right offsets', async () => {
    server = await startFakeServer({ size: 10_000 });
    const h = harness(10_000);
    const seg = { start: 1000, end: 4999, downloaded: 0 };
    await run(server.url, seg, h);
    expect(seg.downloaded).toBe(4000);
    expect(h.file.subarray(1000, 5000).equals(server.data.subarray(1000, 5000))).toBe(true);
  });

  it('resumes from segment.downloaded', async () => {
    server = await startFakeServer({ size: 10_000 });
    const h = harness(10_000);
    const seg = { start: 0, end: 9_999, downloaded: 6_000 };
    await run(server.url, seg, h);
    expect(server.requests[0]!.range).toBe('bytes=6000-9999');
    expect(h.file.subarray(6000).equals(server.data.subarray(6000))).toBe(true);
  });

  it('extraBytes never reach writeAt', async () => {
    server = await startFakeServer({ size: 10_000, extraBytes: 50 });
    const h = harness(10_000);
    const seg = { start: 0, end: 999, downloaded: 0 };
    await run(server.url, seg, h);
    expect(h.writes.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(seg.downloaded).toBe(1000);
  });

  it('ignoreRange throws RangeIgnoredError', async () => {
    server = await startFakeServer({ size: 1000, ignoreRange: true });
    await expect(run(server.url, { start: 0, end: 99, downloaded: 0 }, harness(1000))).rejects.toBeInstanceOf(
      RangeIgnoredError,
    );
  });

  it('dropEvery throws ShortSegmentError and downloaded equals bytes written', async () => {
    server = await startFakeServer({ size: 200_000, dropEvery: 1 });
    const h = harness(200_000);
    const seg = { start: 0, end: 199_999, downloaded: 0 };
    await expect(run(server.url, seg, h)).rejects.toBeInstanceOf(ShortSegmentError);
    expect(seg.downloaded).toBe(h.writes.reduce((a, b) => a + b, 0));
    expect(seg.downloaded).toBeLessThan(200_000);
  });

  it('shortening segment.end mid-run stops at the new end', async () => {
    server = await startFakeServer({ size: 400_000, bytesPerSecPerConnection: 1_000_000 });
    const h = harness(400_000);
    const seg = { start: 0, end: 399_999, downloaded: 0 };
    const done = runSegment({
      url: `${server.url}/file`, segment: seg, etag: null, signal: new AbortController().signal,
      writeAt: h.writeAt,
      onBytes: () => { if (seg.downloaded > 0) seg.end = 99_999; },
    });
    await done;
    expect(seg.downloaded).toBe(100_000);
    expect(h.file.subarray(0, 100_000).equals(server.data.subarray(0, 100_000))).toBe(true);
  });

  it('abort rejects with AbortError', async () => {
    server = await startFakeServer({ size: 1_000_000, bytesPerSecPerConnection: 100_000 });
    const controller = new AbortController();
    const p = run(server.url, { start: 0, end: 999_999, downloaded: 0 }, harness(1_000_000), controller.signal);
    setTimeout(() => controller.abort(), 100);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

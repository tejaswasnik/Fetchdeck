import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from './helpers/fakeServer.js';

let server: FakeServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('fakeServer', () => {
  it('ranged request returns 206 with exact Content-Range and bytes', async () => {
    server = await startFakeServer({ size: 1000 });
    const res = await fetch(`${server.url}/file`, { headers: { Range: 'bytes=10-19' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/1000');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(server.data.subarray(10, 20))).toBe(true);
  });

  it('no Range header returns 200 and full body', async () => {
    server = await startFakeServer({ size: 1000 });
    const res = await fetch(`${server.url}/file`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(server.data)).toBe(true);
  });

  it('ignoreRange returns 200 even with a Range header', async () => {
    server = await startFakeServer({ size: 1000, ignoreRange: true });
    const res = await fetch(`${server.url}/file`, { headers: { Range: 'bytes=0-9' } });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
  });

  it('size 0 answers a range with 416 and bytes */0', async () => {
    server = await startFakeServer({ size: 0 });
    const res = await fetch(`${server.url}/file`, { headers: { Range: 'bytes=0-0' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */0');
  });

  it('records each request path and Range header', async () => {
    server = await startFakeServer({ size: 100 });
    await (await fetch(`${server.url}/file`)).arrayBuffer();
    await (await fetch(`${server.url}/file`, { headers: { Range: 'bytes=0-9' } })).arrayBuffer();
    expect(server.requests).toEqual([
      { path: '/file', range: null },
      { path: '/file', range: 'bytes=0-9' },
    ]);
  });
});

describe('fakeServer modes', () => {
  it('omitLength sends no Content-Length', async () => {
    server = await startFakeServer({ size: 1000, omitLength: true, ignoreRange: true });
    const res = await fetch(`${server.url}/file`);
    expect(res.headers.get('content-length')).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(1000);
  });

  it('extraBytes sends N bytes past the range end', async () => {
    server = await startFakeServer({ size: 1000, extraBytes: 7 });
    const res = await fetch(`${server.url}/file`, { headers: { Range: 'bytes=0-9' } });
    expect((await res.arrayBuffer()).byteLength).toBe(17);
  });

  it('dropEvery cuts the Nth response short', async () => {
    server = await startFakeServer({ size: 100_000, dropEvery: 2 });
    const first = await fetch(`${server.url}/file`);
    expect((await first.arrayBuffer()).byteLength).toBe(100_000);
    const second = await fetch(`${server.url}/file`);
    await expect(second.arrayBuffer()).rejects.toThrow();
  });

  it('failNext(503, 2) fails exactly two requests', async () => {
    server = await startFakeServer({ size: 10 });
    server.failNext(503, 2, 3);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${server.url}/file`);
      statuses.push(res.status);
      await res.arrayBuffer();
    }
    expect(statuses).toEqual([503, 503, 200]);
  });

  it('/redirect answers 302 to /file', async () => {
    server = await startFakeServer({ size: 10 });
    const res = await fetch(`${server.url}/redirect`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/file');
  });

  it('stale If-Range returns 200', async () => {
    server = await startFakeServer({ size: 100, etag: '"v1"' });
    const fresh = await fetch(`${server.url}/file`, { headers: { Range: 'bytes=0-9', 'If-Range': '"v1"' } });
    expect(fresh.status).toBe(206);
    await fresh.arrayBuffer();
    const stale = await fetch(`${server.url}/file`, { headers: { Range: 'bytes=0-9', 'If-Range': '"old"' } });
    expect(stale.status).toBe(200);
  });
});

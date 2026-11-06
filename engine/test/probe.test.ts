import { afterEach, describe, expect, it } from 'vitest';
import { HttpStatusError, InvalidUrlError } from '../src/errors';
import { probe } from '../src/probe';
import { startFakeServer, type FakeServer } from './helpers/fakeServer';

let server: FakeServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('probe', () => {
  it('206 gives size, rangeSupported, etag, filename', async () => {
    server = await startFakeServer({ size: 1234, etag: '"abc"', contentDisposition: 'attachment; filename="x.bin"' });
    expect(await probe(`${server.url}/file`)).toMatchObject({
      size: 1234, rangeSupported: true, etag: '"abc"', filename: 'x.bin',
    });
  });

  it('ignoreRange gives rangeSupported false and size from Content-Length', async () => {
    server = await startFakeServer({ size: 500, ignoreRange: true });
    expect(await probe(`${server.url}/file`)).toMatchObject({ size: 500, rangeSupported: false });
  });

  it('omitLength gives size null', async () => {
    server = await startFakeServer({ size: 500, omitLength: true });
    expect((await probe(`${server.url}/file`)).size).toBeNull();
  });

  it('size 0 gives size 0', async () => {
    server = await startFakeServer({ size: 0 });
    expect(await probe(`${server.url}/file`)).toMatchObject({ size: 0, rangeSupported: false });
  });

  it('/redirect gives finalUrl ending in /file', async () => {
    server = await startFakeServer({ size: 10 });
    const result = await probe(`${server.url}/redirect`);
    expect(result.finalUrl.endsWith('/file')).toBe(true);
    expect(result.filename).toBe('file');
  });

  it('404 throws HttpStatusError with status 404', async () => {
    server = await startFakeServer({ size: 10 });
    await expect(probe(`${server.url}/nope`)).rejects.toMatchObject({ name: 'HttpStatusError', status: 404 });
  });

  it('503 with Retry-After 2 gives retryAfterMs 2000', async () => {
    server = await startFakeServer({ size: 10 });
    server.failNext(503, 1, 2);
    const err = await probe(`${server.url}/file`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpStatusError);
    expect((err as HttpStatusError).retryAfterMs).toBe(2000);
  });

  it('bad URLs throw InvalidUrlError and the server saw no requests', async () => {
    server = await startFakeServer({ size: 10 });
    await expect(probe('ftp://x')).rejects.toBeInstanceOf(InvalidUrlError);
    await expect(probe('not a url')).rejects.toBeInstanceOf(InvalidUrlError);
    expect(server.requests).toHaveLength(0);
  });
});

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HeadersProvider } from '../src/headers';
import { delay, makeDownload } from './helpers/downloadHarness';
import { startFakeServer, type FakeServer } from './helpers/fakeServer';

const MIB = 1_048_576;
const SECRET = 'sid=SECRET';
const credentials: HeadersProvider = async () => ({ Cookie: SECRET, Referer: 'https://site.example/p', 'User-Agent': 'UA/1' });

const servers: FakeServer[] = [];
const start = async (options: Parameters<typeof startFakeServer>[0]): Promise<FakeServer> => {
  const server = await startFakeServer(options);
  servers.push(server);
  return server;
};
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const sha = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');

describe('Download: request headers', () => {
  it('probe and every segment request carry Referer, User-Agent and the Cookie; Range stays the engine’s', async () => {
    const server = await start({ size: 4 * MIB });
    const { download } = await makeDownload(`${server.url}/file`, { headers: credentials });
    await download.start();
    expect(download.record.status).toBe('done');
    expect(server.requests.length).toBeGreaterThan(2);
    for (const request of server.requests) {
      expect(request.headers.cookie).toBe(SECRET);
      expect(request.headers.referer).toBe('https://site.example/p');
      expect(request.headers['user-agent']).toBe('UA/1');
      expect(request.headers['accept-encoding']).toContain('identity');
      expect(request.range).toMatch(/^bytes=\d+-\d+$/);
    }
  });

  it('the single-stream fallback request carries them too', async () => {
    const server = await start({ size: 2 * MIB, ignoreRange: true });
    const { download } = await makeDownload(`${server.url}/file`, { headers: credentials });
    await download.start();
    expect(download.record.status).toBe('done');
    expect(server.requests.length).toBeGreaterThanOrEqual(2); // the probe and the stream
    for (const request of server.requests) {
      expect(request.headers.cookie).toBe(SECRET);
      expect(request.headers['user-agent']).toBe('UA/1');
    }
  });

  it('the Cookie reaches only the original origin, also on segment requests sent straight to the redirected address', async () => {
    const cdn = await start({ size: 4 * MIB });
    const origin = await start({});
    const { download, saveDir } = await makeDownload(`${origin.url}/cross?to=${encodeURIComponent(`${cdn.url}/file`)}`, { headers: credentials });
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await sha(join(saveDir, 'file'))).toBe(cdn.sha256);
    expect(origin.requests.every((r) => r.headers.cookie === SECRET)).toBe(true);
    const direct = cdn.requests.filter((r) => r.range !== null);
    expect(direct.length).toBeGreaterThan(1); // the segments really went to the CDN
    for (const request of cdn.requests) {
      expect(request.headers).not.toHaveProperty('cookie');
      expect(request.headers.referer).toBe('https://site.example/p');
      expect(request.headers['user-agent']).toBe('UA/1');
    }
  });

  it('the re-probe after an expired link carries them', async () => {
    const server = await start({ size: 2 * MIB, linkTtlMs: 60 });
    server.failNext(503, 2);
    const { download } = await makeDownload(`${server.url}/signed`, {
      maxSegments: 2,
      headers: credentials,
      sleep: async () => delay(100), // outlive the link
    });
    await download.start();
    expect(download.record.status).toBe('done');
    const signed = server.requests.filter((r) => r.path === '/signed');
    expect(signed.length).toBeGreaterThanOrEqual(2);
    expect(signed.every((r) => r.headers.cookie === SECRET)).toBe(true);
  });

  it('a provider that throws ends the download in error with its message and no retry', async () => {
    const server = await start({ size: 2 * MIB });
    const { download } = await makeDownload(`${server.url}/file`, {
      headers: async () => {
        throw new Error('Needs the link from your browser again');
      },
    });
    await download.start();
    expect(download.record.status).toBe('error');
    expect(download.record.error).toBe('Needs the link from your browser again');
    expect(server.requests).toHaveLength(0);
  });

  it('the record on disk never contains the cookie', async () => {
    const server = await start({ size: 2 * MIB });
    const { download, recordPath } = await makeDownload(`${server.url}/file`, { headers: credentials });
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await readFile(recordPath, 'utf8')).not.toContain('SECRET');
  });
});

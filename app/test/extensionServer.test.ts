import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptureLine, type CaptureLine } from '../main/captureLine';
import { createExtensionServer, type ExtensionServer } from '../main/extensionServer';

const TOKEN = 'T'.repeat(43);
let token = TOKEN;
let clock = 1_000_000;
let line: CaptureLine;
let server: ExtensionServer;
let port: number;

beforeEach(async () => {
  token = TOKEN;
  clock = 1_000_000;
  line = createCaptureLine();
  server = createExtensionServer({ port: 0, version: '1.2.0', getToken: async () => token, line, now: () => clock });
  expect(await server.start()).toBe('running');
  port = server.port();
});
afterEach(() => server.stop());

type Call = { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer; auth?: string | null };
type Reply = { status: number; json: unknown; headers: Record<string, string | string[] | undefined> };

// Raw http, because fetch will not let a test lie about Host or Origin.
const call = ({ method = 'GET', path, headers = {}, body, auth = TOKEN }: Call): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const allHeaders: Record<string, string> = { ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }), ...headers };
    if (body !== undefined) {
      allHeaders['Content-Type'] ??= 'application/json';
      allHeaders['Content-Length'] = String(Buffer.byteLength(body));
    }
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: allHeaders }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = text;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode ?? 0, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.end(body);
  });

const post = (body: unknown, extra: Partial<Call> = {}): Promise<Reply> =>
  call({ method: 'POST', path: '/v1/captures', body: typeof body === 'string' ? body : JSON.stringify(body), ...extra });

const GOOD = { url: 'https://site.example/big.zip', cookie: 'sid=SECRET', referer: 'https://site.example/p', userAgent: 'UA/1', filename: 'big.zip', size: 6_000_000 };

describe('request checks', () => {
  it('answers ping with the app and version', async () => {
    const reply = await call({ path: '/v1/ping' });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ app: 'fetchdeck', version: '1.2.0' });
  });

  it('refuses a Host that is not 127.0.0.1 or localhost on this port (DNS rebinding)', async () => {
    expect((await call({ path: '/v1/ping', headers: { Host: `evil.example:${port}` } })).status).toBe(403);
    expect((await call({ path: '/v1/ping', headers: { Host: '127.0.0.1:1' } })).status).toBe(403);
    expect((await call({ path: '/v1/ping', headers: { Host: `localhost:${port}` } })).status).toBe(200);
  });

  it('needs the right token', async () => {
    expect((await call({ path: '/v1/ping', auth: null })).status).toBe(401);
    expect((await call({ path: '/v1/ping', auth: 'wrong' })).status).toBe(401);
    expect((await call({ path: '/v1/ping', auth: 'T'.repeat(42) })).status).toBe(401);
    expect((await call({ path: '/v1/ping', headers: { Authorization: TOKEN } , auth: null })).status).toBe(401);
  });

  it('refuses an Origin that is not a chrome-extension, and allows one that is', async () => {
    expect((await call({ path: '/v1/ping', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call({ path: '/v1/ping', headers: { Origin: 'null' } })).status).toBe(403);
    expect((await call({ path: '/v1/ping', headers: { Origin: 'chrome-extension://abcdefghijklmnop' } })).status).toBe(200);
  });

  it('never approves a cross-origin preflight', async () => {
    const reply = await call({ method: 'OPTIONS', path: '/v1/captures', auth: null, headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers 404 for unknown paths and 405 for other methods', async () => {
    expect((await call({ path: '/v1/nothing' })).status).toBe(404);
    expect((await call({ method: 'DELETE', path: '/v1/captures/x' })).status).toBe(405);
  });

  it('a regenerated token takes effect at once: the old one stops working', async () => {
    expect((await call({ path: '/v1/ping' })).status).toBe(200);
    token = 'N'.repeat(43);
    expect((await call({ path: '/v1/ping' })).status).toBe(401);
    expect((await call({ path: '/v1/ping', auth: token })).status).toBe(200);
  });

  it('locks out after 10 wrong tokens in a minute, even for the right token, until a minute has passed', async () => {
    for (let i = 0; i < 10; i++) expect((await call({ path: '/v1/ping', auth: 'wrong' })).status).toBe(401);
    expect((await call({ path: '/v1/ping' })).status).toBe(429);
    clock += 59_000;
    expect((await call({ path: '/v1/ping' })).status).toBe(429);
    clock += 2_000;
    expect((await call({ path: '/v1/ping' })).status).toBe(200);
  });

  it('failures older than a minute do not count', async () => {
    for (let i = 0; i < 9; i++) await call({ path: '/v1/ping', auth: 'wrong' });
    clock += 61_000;
    for (let i = 0; i < 9; i++) await call({ path: '/v1/ping', auth: 'wrong' });
    expect((await call({ path: '/v1/ping' })).status).toBe(200);
  });
});

describe('POST /v1/captures', () => {
  it('accepts a good capture: 202, and the line shows it without the cookie', async () => {
    const reply = await post(GOOD);
    expect(reply.status).toBe(202);
    const { captureId } = reply.json as { captureId: string };
    expect(line.view()).toEqual({ captureId, url: GOOD.url, filename: 'big.zip', size: 6_000_000, waiting: 0 });
    expect(JSON.stringify(line.view())).not.toContain('SECRET');
    expect(line.take(captureId).headers).toEqual({ Cookie: 'sid=SECRET', Referer: GOOD.referer, 'User-Agent': 'UA/1' });
  });

  it('accepts a bare link', async () => {
    expect((await post({ url: 'http://x.example/f' })).status).toBe(202);
    expect(line.view()).toMatchObject({ filename: null, size: null });
  });

  it('refuses a body over 64 KB with 413 and a non-JSON content type with 415', async () => {
    expect((await post(JSON.stringify({ url: 'http://x/f', cookie: 'a'.repeat(70 * 1024) }))).status).toBe(413);
    expect((await post(JSON.stringify(GOOD), { headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect(line.view()).toBeNull();
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['not JSON', '{nope'],
    ['a missing url', { cookie: 'a=1' }],
    ['a file: url', { url: 'file:///etc/passwd' }],
    ['a javascript: url', { url: 'javascript:alert(1)' }],
    ['a blob: url', { url: 'blob:https://x.example/uuid' }],
    ['a data: url', { url: 'data:text/plain;base64,AAAA' }],
    ['a too long url', { url: `http://x.example/${'a'.repeat(2100)}` }],
    ['a url with a line break', { url: 'http://x.example/f\r\nHost: evil' }],
    ['a cookie with CR/LF', { url: 'http://x/f', cookie: 'a=1\r\nX-Evil: 1' }],
    ['a referer with a control character', { url: 'http://x/f', referer: 'http://a/\u0000' }],
    ['a user agent with a newline', { url: 'http://x/f', userAgent: 'UA\n1' }],
    ['an unknown key', { url: 'http://x/f', admin: true }],
    ['a non-string cookie', { url: 'http://x/f', cookie: 5 }],
    ['a negative size', { url: 'http://x/f', size: -1 }],
    ['a fractional size', { url: 'http://x/f', size: 1.5 }],
    ['a cookie over the limit', { url: 'http://x/f', cookie: 'a'.repeat(9000) }],
  ])('rejects %s with 400 and nothing reaches the line', async (_name, body) => {
    const reply = await post(body);
    expect(reply.status).toBe(400);
    expect(typeof (reply.json as { error: string }).error).toBe('string');
    expect(line.view()).toBeNull();
  });

  it('answers 429 when 20 captures are already waiting', async () => {
    for (let i = 0; i < 20; i++) line.submit({ url: `http://x.example/${i}`, headers: {}, filename: null, size: null });
    expect((await post(GOOD)).status).toBe(429);
  });
});

describe('GET /v1/captures/:id', () => {
  it('answers accepted as soon as the line accepts', async () => {
    const { captureId } = (await post(GOOD)).json as { captureId: string };
    const waiting = call({ path: `/v1/captures/${captureId}?wait=20` });
    setTimeout(() => line.accept(captureId), 50);
    const reply = await waiting;
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ state: 'accepted' });
  });

  it('answers pending at once with wait=0 or no wait, and 404 for an unknown id', async () => {
    const { captureId } = (await post(GOOD)).json as { captureId: string };
    expect((await call({ path: `/v1/captures/${captureId}?wait=0` })).json).toEqual({ state: 'pending' });
    expect((await call({ path: `/v1/captures/${captureId}` })).json).toEqual({ state: 'pending' });
    expect((await call({ path: '/v1/captures/nope?wait=0' })).status).toBe(404);
  });

  it('never waits longer than 20 seconds, whatever the client asks', async () => {
    const poll = vi.spyOn(line, 'poll').mockResolvedValue('pending');
    await call({ path: '/v1/captures/abc?wait=999' });
    await call({ path: '/v1/captures/abc?wait=-5' });
    await call({ path: '/v1/captures/abc?wait=soon' });
    expect(poll.mock.calls.map(([, ms]) => ms)).toEqual([20_000, 0, 0]);
  });

  it('stopping the server ends a pending long-poll as dismissed, so the browser download can resume', async () => {
    const { captureId } = (await post(GOOD)).json as { captureId: string };
    const waiting = call({ path: `/v1/captures/${captureId}?wait=20` });
    await new Promise((r) => setTimeout(r, 50));
    await server.stop();
    expect((await waiting).json).toEqual({ state: 'dismissed' });
    expect(server.status()).toBe('off');
  });
});

describe('lifecycle', () => {
  it('reports port-in-use instead of throwing when the port is taken', async () => {
    const blocker = createNetServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as { port: number }).port;
    const other = createExtensionServer({ port: taken, version: '1.2.0', getToken: async () => TOKEN, line: createCaptureLine() });
    expect(await other.start()).toBe('port-in-use');
    expect(other.status()).toBe('port-in-use');
    await other.stop();
    await new Promise((r) => blocker.close(r));
  });

  it('is off before start and after stop, and a second stop is harmless', async () => {
    const idle = createExtensionServer({ port: 0, version: '1.2.0', getToken: async () => TOKEN, line: createCaptureLine() });
    expect(idle.status()).toBe('off');
    await idle.stop();
    await server.stop();
    await server.stop();
    expect(server.status()).toBe('off');
  });
});

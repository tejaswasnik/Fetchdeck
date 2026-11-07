import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptureLine, type CaptureLine } from '../../app/main/captureLine';
import { createExtensionServer, type ExtensionServer } from '../../app/main/extensionServer';
import { ClientError, POLL_WAIT_SECONDS, createFetchdeckClient } from '../src/fetchdeckClient';

const TOKEN = 'T'.repeat(43);
let token = TOKEN;
let line: CaptureLine;
let server: ExtensionServer;
let baseUrl: string;

beforeEach(async () => {
  token = TOKEN;
  line = createCaptureLine();
  server = createExtensionServer({ port: 0, version: '1.2.0', getToken: async () => token, line });
  await server.start();
  baseUrl = `http://127.0.0.1:${server.port()}`;
});
afterEach(() => server.stop());

const client = (patch: Partial<Parameters<typeof createFetchdeckClient>[0]> = {}) =>
  createFetchdeckClient({ baseUrl, getToken: async () => TOKEN, retryDelayMs: 0, ...patch });
const GOOD = { url: 'https://site.example/big.zip', cookie: 'sid=SECRET', referer: 'https://site.example/p', userAgent: 'UA/1', size: 6_000_000 };
const kindOf = async (run: Promise<unknown>) => {
  const error: unknown = await run.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ClientError);
  return (error as ClientError).kind;
};

describe('createFetchdeckClient', () => {
  it('polls for at most 20 seconds at a time', () => {
    expect(POLL_WAIT_SECONDS).toBe(20);
  });

  it('ping returns the app version', async () => {
    expect(await client().ping()).toEqual({ version: '1.2.0' });
  });

  it('a wrong token is wrong-token, and so is a token that was regenerated since', async () => {
    expect(await kindOf(client({ getToken: async () => 'wrong' }).ping())).toBe('wrong-token');
    token = 'N'.repeat(43);
    expect(await kindOf(client().ping())).toBe('wrong-token');
  });

  it('a closed port is not-running', async () => {
    const dead = `http://127.0.0.1:${server.port()}`;
    await server.stop();
    expect(await kindOf(client({ baseUrl: dead }).ping())).toBe('not-running');
  });

  it('something else on the port that does not answer like Fetchdeck is not-running, not a wrong token', async () => {
    const other = client({ fetch: async () => new Response('<html>hello</html>', { status: 200 }) });
    expect(await kindOf(other.ping())).toBe('not-running');
  });

  it('a capture the app refuses (400) is rejected, with the app\'s reason', async () => {
    const error: unknown = await client().postCapture({ url: 'file:///etc/passwd' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientError);
    expect((error as ClientError).kind).toBe('rejected');
    expect((error as ClientError).message).not.toBe('');
  });

  it('a full line (429) is rejected so the browser download carries on', async () => {
    for (let i = 0; i < 20; i++) line.submit({ url: `http://x.example/${i}`, headers: {}, filename: null, size: null });
    expect(await kindOf(client().postCapture(GOOD))).toBe('rejected');
  });

  it('postCapture puts the capture on the line and returns its id', async () => {
    const { captureId } = await client().postCapture(GOOD);
    expect(line.view()).toMatchObject({ captureId, url: GOOD.url, size: 6_000_000 });
    expect(line.take(captureId).headers).toEqual({ Cookie: 'sid=SECRET', Referer: GOOD.referer, 'User-Agent': 'UA/1' });
  });

  it.each([['accept', 'accepted'], ['dismiss', 'dismissed']] as const)('waitForOutcome returns %sed once the app answers', async (action, outcome) => {
    const { captureId } = await client().postCapture(GOOD);
    const waiting = client().waitForOutcome(captureId);
    setTimeout(() => line[action](captureId), 50);
    expect(await waiting).toBe(outcome);
  });

  it('waitForOutcome keeps asking while the answer is still pending', async () => {
    const { captureId } = await client().postCapture(GOOD);
    const seen: string[] = [];
    // The same server, but each long-poll is shortened to 0.1 s so the test does not take 20 s per round.
    const quick = client({
      fetch: (input, init) => {
        const url = new URL(String(input));
        url.searchParams.set('wait', '0.1');
        seen.push(url.search);
        return fetch(url, init);
      },
    });
    const waiting = quick.waitForOutcome(captureId);
    setTimeout(() => line.accept(captureId), 450);
    expect(await waiting).toBe('accepted');
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it('asks the app to wait POLL_WAIT_SECONDS', async () => {
    const urls: string[] = [];
    const answers = [{ state: 'pending' }, { state: 'accepted' }];
    const scripted = client({
      fetch: async (input) => {
        urls.push(String(input));
        return Response.json(answers.shift());
      },
    });
    await scripted.waitForOutcome('abc');
    expect(urls[0]).toBe(`${baseUrl}/v1/captures/abc?wait=${POLL_WAIT_SECONDS}`);
  });

  it('gives up after three failed polls in a row', async () => {
    const { captureId } = await client().postCapture(GOOD);
    const dead = `http://127.0.0.1:${server.port()}`;
    await server.stop();
    const fetchSpy = vi.fn(fetch);
    expect(await kindOf(client({ baseUrl: dead, fetch: fetchSpy }).waitForOutcome(captureId))).toBe('not-running');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('a poll that works in between resets the count', async () => {
    const script: Array<() => Response | Promise<Response>> = [
      () => { throw new TypeError('fetch failed'); },
      () => { throw new TypeError('fetch failed'); },
      () => Response.json({ state: 'pending' }),
      () => { throw new TypeError('fetch failed'); },
      () => { throw new TypeError('fetch failed'); },
      () => Response.json({ state: 'accepted' }),
    ];
    const flaky = client({ fetch: async () => script.shift()!() });
    expect(await flaky.waitForOutcome('abc')).toBe('accepted');
    expect(script).toHaveLength(0);
  });

  it('a capture the app no longer knows (404) ends the wait as rejected', async () => {
    expect(await kindOf(client().waitForOutcome('gone'))).toBe('rejected');
  });

  it('reads the token again for every request, so a token regenerated mid-wait is used by the next poll', async () => {
    const { captureId } = await client().postCapture(GOOD);
    let current = TOKEN;
    const getToken = vi.fn(async () => current);
    const quick = client({
      getToken,
      fetch: (input, init) => {
        const url = new URL(String(input));
        url.searchParams.set('wait', '0.05');
        return fetch(url, init);
      },
    });
    const waiting = quick.waitForOutcome(captureId);
    setTimeout(() => { token = 'N'.repeat(43); current = 'N'.repeat(43); }, 120);
    setTimeout(() => line.accept(captureId), 400);
    expect(await waiting).toBe('accepted');
    expect(getToken.mock.calls.length).toBeGreaterThan(3);
  });
});

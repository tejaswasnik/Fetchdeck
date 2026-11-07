import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCaptureLine } from '../../app/main/captureLine';
import { createExtensionServer } from '../../app/main/extensionServer';

// Runs the real extension in a real Chromium against the real local server (the app's server code in plain
// Node) and a throttled download server. Port 47600 is fixed in the extension, so Fetchdeck itself must not
// be running its browser extension server while this runs.

const DIST = process.env.FETCHDECK_EXTENSION_DIST ?? fileURLToPath(new URL('../dist', import.meta.url));
const FILE_SIZE = 6 * 1024 * 1024;
const BYTES_PER_SECOND = 3 * 1024 * 1024; // slow enough that the download is still running when the extension pauses it
const TICK_MS = 25;
const TOKEN = 'e2e-token-'.padEnd(43, 'x');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves when the response can take more data, or is gone.
const drained = (res: ServerResponse): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });

const sendSlowly = async (res: ServerResponse, data: Buffer): Promise<void> => {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="big.bin"',
    'Content-Length': String(data.length),
  });
  const step = Math.floor((BYTES_PER_SECOND * TICK_MS) / 1000);
  for (let position = 0; position < data.length; position += step) {
    if (res.destroyed) return;
    // While the browser has the download paused it stops reading, and this waits for it.
    if (!res.write(data.subarray(position, position + step))) await drained(res);
    await sleep(TICK_MS);
  }
  res.end();
};

const startSite = async (): Promise<{ url: string; sha256: string; close(): Promise<void> }> => {
  const data = randomBytes(FILE_SIZE);
  const server: Server = createServer((req, res) => {
    if (req.url === '/page') {
      // The cookie is what lets the test see that logged-in downloads carry their credentials.
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'sid=abc123; Path=/' });
      res.end('<!doctype html><title>Site</title><a id="dl" href="/big.bin">Download</a>');
    } else if (req.url === '/big.bin') {
      void sendSlowly(res, data);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sha256: createHash('sha256').update(data).digest('hex'),
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
};

const sha256Of = async (path: string): Promise<string> => {
  const { readFile } = await import('node:fs/promises');
  return createHash('sha256').update(await readFile(path)).digest('hex');
};

describe('the extension in a real Chromium', () => {
  const line = createCaptureLine();
  let token = TOKEN;
  const app = createExtensionServer({ version: 'e2e', getToken: async () => token, line });
  let site: Awaited<ReturnType<typeof startSite>>;
  let context: BrowserContext;
  let profile: string;

  const worker = (): Worker => {
    // After a restart Playwright can list the stopped worker too; the newest one is the live one.
    const current = context.serviceWorkers().at(-1);
    if (!current) throw new Error('The extension service worker is not running.');
    return current;
  };
  const browserDownloads = () => worker().evaluate(() => chrome.downloads.search({}));

  beforeAll(async () => {
    expect(await app.start(), 'Port 47600 is in use: quit Fetchdeck (or switch its Browser extension off) and run again.').toBe('running');
    site = await startSite();
    profile = await mkdtemp(join(tmpdir(), 'fetchdeck-e2e-'));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', // full Chromium in new headless mode; the default headless shell cannot load extensions
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    const first = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await first.evaluate((value) => chrome.storage.local.set({ token: value }), TOKEN);
  });

  afterAll(async () => {
    await context?.close();
    await app.stop();
    await site?.close();
    if (profile) await rm(profile, { recursive: true, force: true });
  });

  afterEach(async () => {
    token = TOKEN;
    line.closeAll();
    if ((await app.start()) !== 'running') throw new Error('The test server could not be restarted.');
    await Promise.all(context.pages().map((page) => page.close()));
    await worker().evaluate(() => chrome.downloads.erase({}));
  });

  // Opens the site and clicks its download link; resolves once the browser has started the download.
  const startDownload = async () => {
    const page = await context.newPage();
    await page.goto(`${site.url}/page`);
    const started = page.waitForEvent('download');
    await page.click('#dl');
    return { page, download: await started };
  };
  // Stops the extension's service worker the way the browser does when it is idle. Playwright's own list of
  // workers does not notice that, so the state is read from the browser itself, through a page of the extension.
  const stopServiceWorker = async (carrier: Page): Promise<void> => {
    const cdp = await context.newCDPSession(carrier);
    const status = new Map<string, string>();
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      for (const version of versions) if (version.scriptURL.endsWith('/background.js')) status.set(version.versionId, version.runningStatus);
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => status.size, { timeout: 10_000 }).toBeGreaterThan(0);
    for (const versionId of status.keys()) await cdp.send('ServiceWorker.stopWorker', { versionId });
    await expect.poll(() => [...status.values()], { timeout: 10_000 }).toEqual(['stopped']);
  };
  const waitForCapture = async (): Promise<string> => {
    await expect.poll(() => line.view(), { timeout: 10_000 }).not.toBeNull();
    return line.view()!.captureId;
  };

  it('accepted in the app: the browser download is cancelled and erased, and the app got the login', async () => {
    const { download } = await startDownload();
    const id = await waitForCapture();
    const { headers, url } = line.take(id);
    expect(url).toBe(`${site.url}/big.bin`);
    expect(headers.Cookie).toContain('sid=abc123');
    expect(headers.Referer).toBe(`${site.url}/page`);
    expect(headers['User-Agent']).toMatch(/Chrome\//);
    line.accept(id);
    expect(await download.failure()).toBe('canceled');
    await expect.poll(browserDownloads, { timeout: 10_000 }).toEqual([]);
  });

  it('dismissed in the app: the browser download carries on and arrives intact', async () => {
    const { download } = await startDownload();
    line.dismiss(await waitForCapture());
    expect(await download.failure()).toBeNull();
    expect(await sha256Of(await download.path())).toBe(site.sha256);
  });

  it('Fetchdeck not running: the browser download is resumed at once and arrives intact', async () => {
    await app.stop();
    const { download } = await startDownload();
    expect(await download.failure()).toBeNull();
    expect(await sha256Of(await download.path())).toBe(site.sha256);
  });

  it('a wrong token: the browser download carries on and arrives intact', async () => {
    token = 'a-different-token-'.padEnd(43, 'y');
    const { download } = await startDownload();
    expect(await download.failure()).toBeNull();
    expect(await sha256Of(await download.path())).toBe(site.sha256);
    expect(line.view()).toBeNull();
  });

  it('the token regenerated while a capture waits: the browser download carries on and arrives intact', async () => {
    const { download } = await startDownload();
    await waitForCapture();
    token = 'regenerated-'.padEnd(43, 'z'); // the poll in flight ends within 20 s, the next one is refused three times
    expect(await download.failure()).toBeNull();
    expect(await sha256Of(await download.path())).toBe(site.sha256);
  });

  it('the browser stops the extension while a capture waits: the download is resumed when the extension wakes', async () => {
    const { download } = await startDownload();
    await waitForCapture();
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker().url()).host}/popup.html`);
    await stopServiceWorker(popup);

    // Changing a setting is an event the extension listens for, so it starts again and picks up what was left waiting.
    await popup.evaluate(() => chrome.storage.local.set({ woke: Date.now() }));

    expect(await download.failure()).toBeNull();
    expect(await sha256Of(await download.path())).toBe(site.sha256);
  });
});

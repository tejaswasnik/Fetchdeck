import { describe, expect, it, vi } from 'vitest';
import type { ChromeLike } from '../src/chromeLike';
import { createCaptureController } from '../src/controller';
import { ClientError, type FetchdeckClient } from '../src/fetchdeckClient';
import { DEFAULT_THRESHOLD_BYTES, type DownloadItemLike } from '../src/shouldCapture';

const MB = 1024 * 1024;
const item = (patch: Partial<DownloadItemLike> = {}): DownloadItemLike => ({
  id: 7, url: 'https://site.example/files/big.zip', referrer: 'https://site.example/page', filename: '', totalBytes: 6 * MB, state: 'in_progress', ...patch,
});

// A recording fake of the browser: `calls` is the order in which the controller touched it.
const setup = (settings = { enabled: true, thresholdBytes: DEFAULT_THRESHOLD_BYTES }) => {
  const calls: string[] = [];
  const session = new Map<string, unknown>();
  const record = (name: string, result?: unknown) => vi.fn(async (...args: unknown[]) => {
    calls.push(`${name}${args.length > 0 ? `:${JSON.stringify(args[0])}` : ''}`);
    return result;
  });
  const chrome = {
    downloads: {
      pause: record('pause'),
      resume: record('resume'),
      cancel: record('cancel'),
      erase: record('erase', []),
      download: record('download', 99),
      onCreated: { addListener: vi.fn() },
    },
    cookies: { getAll: vi.fn(async () => [{ name: 'sid', value: 'abc' }]) },
    contextMenus: { create: vi.fn(), removeAll: vi.fn(), onClicked: { addListener: vi.fn() } },
    storage: {
      local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      session: {
        get: vi.fn(async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter((k) => session.has(k)).map((k) => [k, session.get(k)]));
        }),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.entries(items).forEach(([k, v]) => session.set(k, v)); }),
        remove: vi.fn(async (key: string | string[]) => { [key].flat().forEach((k) => session.delete(k)); }),
      },
    },
    action: { setBadgeText: vi.fn() },
    runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
  };
  const client = {
    ping: vi.fn(),
    postCapture: vi.fn(async () => { calls.push('post'); return { captureId: 'cap-1' }; }),
    waitForOutcome: vi.fn(async (): Promise<'accepted' | 'dismissed'> => { calls.push('wait'); return 'accepted'; }),
  } satisfies FetchdeckClient;
  const controller = createCaptureController({
    chrome: chrome as unknown as ChromeLike,
    client,
    getSettings: async () => settings,
    userAgent: 'UA/1',
  });
  return { calls, session, chrome, client, controller };
};
const notRunning = new ClientError('not-running', 'Fetchdeck is not running.');
const wrongToken = new ClientError('wrong-token', 'Wrong token.');

describe('a browser download', () => {
  it('accepted: pauses, posts, waits, then cancels and erases the browser download, and never resumes it', async () => {
    const { calls, controller, client } = setup();
    await controller.onDownloadCreated(item());
    expect(calls).toEqual(['pause:7', 'post', 'wait', 'cancel:7', 'erase:{"id":7}']);
    expect(client.postCapture).toHaveBeenCalledWith({
      url: 'https://site.example/files/big.zip', cookie: 'sid=abc', referer: 'https://site.example/page', userAgent: 'UA/1', size: 6 * MB,
    });
    expect(client.waitForOutcome).toHaveBeenCalledWith('cap-1');
  });

  it('dismissed: pauses, posts, waits, then lets the browser carry on', async () => {
    const { calls, controller, client } = setup();
    client.waitForOutcome.mockImplementationOnce(async () => { calls.push('wait'); return 'dismissed'; });
    await controller.onDownloadCreated(item());
    expect(calls).toEqual(['pause:7', 'post', 'wait', 'resume:7']);
  });

  it.each([
    ['the app is not running', notRunning],
    ['the token is wrong or was regenerated', wrongToken],
    ['the app refuses the capture', new ClientError('rejected', 'Too many captures.')],
    ['the cookies cannot be read', new TypeError('no cookies')],
  ])('resumes at once, without waiting, when %s', async (_name, error) => {
    const { calls, controller, client, chrome } = setup();
    if (error instanceof ClientError) client.postCapture.mockRejectedValueOnce(error);
    else chrome.cookies.getAll.mockRejectedValueOnce(error);
    await controller.onDownloadCreated(item());
    expect(calls).toEqual(['pause:7', 'resume:7']);
    expect(client.waitForOutcome).not.toHaveBeenCalled();
  });

  it('resumes when the long-poll gives up after three failed polls', async () => {
    const { calls, controller, client } = setup();
    client.waitForOutcome.mockRejectedValueOnce(notRunning);
    await controller.onDownloadCreated(item());
    expect(calls).toEqual(['pause:7', 'post', 'resume:7']);
  });

  it('does not resume a download the app already took when cancelling the browser copy fails', async () => {
    const { calls, controller, chrome } = setup();
    chrome.downloads.cancel.mockRejectedValueOnce(new Error('already gone'));
    await controller.onDownloadCreated(item());
    expect(calls).not.toContain('resume:7');
    expect(chrome.storage.session.remove).toHaveBeenCalled();
  });

  it('posts a download that is delivered twice only once', async () => {
    const { controller, client } = setup();
    await Promise.all([controller.onDownloadCreated(item()), controller.onDownloadCreated(item())]);
    await controller.onDownloadCreated(item());
    expect(client.postCapture).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['already complete', { state: 'complete' as const }],
    ['interrupted', { state: 'interrupted' as const }],
    ['of unknown size', { totalBytes: -1 }],
    ['under the threshold', { totalBytes: 4 * MB }],
    ['a blob: url', { url: 'blob:https://site.example/uuid' }],
    ['a data: url', { url: 'data:text/plain;base64,AAAA' }],
  ])('never touches a download that is %s', async (_name, patch) => {
    const { calls, controller, client } = setup();
    await controller.onDownloadCreated(item(patch));
    expect(calls).toEqual([]);
    expect(client.postCapture).not.toHaveBeenCalled();
  });

  it('does nothing while capturing is switched off', async () => {
    const { calls, controller } = setup({ enabled: false, thresholdBytes: DEFAULT_THRESHOLD_BYTES });
    await controller.onDownloadCreated(item());
    expect(calls).toEqual([]);
  });

  it('leaves the download alone when it cannot be paused (it finished first)', async () => {
    const { calls, controller, chrome, client } = setup();
    chrome.downloads.pause.mockRejectedValueOnce(new Error('Download must be in progress'));
    await controller.onDownloadCreated(item());
    expect(calls).toEqual([]);
    expect(client.postCapture).not.toHaveBeenCalled();
    expect(chrome.downloads.resume).not.toHaveBeenCalled();
    expect(chrome.downloads.cancel).not.toHaveBeenCalled();
  });
});

describe('downloads that are waiting on the app (survives a service-worker restart)', () => {
  it('keeps the id in session storage during the wait and clears it afterwards', async () => {
    const { controller, session, client } = setup();
    let answer: (outcome: 'accepted') => void = () => undefined;
    client.waitForOutcome.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const running = controller.onDownloadCreated(item());
    await vi.waitFor(() => expect(session.get('inFlight')).toEqual([7]));
    answer('accepted');
    await running;
    expect(session.get('inFlight') ?? []).toEqual([]);
  });

  it('tracks two downloads at once without losing either', async () => {
    const { controller, session, client } = setup();
    const answers: Array<(outcome: 'accepted') => void> = [];
    client.waitForOutcome.mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }));
    const first = controller.onDownloadCreated(item({ id: 1 }));
    const second = controller.onDownloadCreated(item({ id: 2, url: 'https://site.example/two.zip' }));
    await vi.waitFor(() => expect([...(session.get('inFlight') as number[])].sort()).toEqual([1, 2]));
    answers.forEach((answer) => answer('accepted'));
    await Promise.all([first, second]);
    expect(session.get('inFlight') ?? []).toEqual([]);
  });

  it('recover resumes every browser download left waiting by a worker that died, and clears the list', async () => {
    const { controller, session, calls } = setup();
    session.set('inFlight', [3, 4]);
    await controller.recover();
    expect(calls.sort()).toEqual(['resume:3', 'resume:4']);
    expect(session.get('inFlight') ?? []).toEqual([]);
  });

  it('recover does nothing when nothing was left, and survives a download that no longer exists', async () => {
    const { controller, session, chrome, calls } = setup();
    await controller.recover();
    expect(calls).toEqual([]);
    session.set('inFlight', [3, 4]);
    chrome.downloads.resume.mockRejectedValueOnce(new Error('No such download'));
    await controller.recover();
    expect(chrome.downloads.resume).toHaveBeenCalledTimes(2);
    expect(session.get('inFlight') ?? []).toEqual([]);
  });

  it('recover leaves alone a download this very worker is still waiting on', async () => {
    const { controller, session, client, chrome } = setup();
    let answer: (outcome: 'accepted') => void = () => undefined;
    client.waitForOutcome.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const running = controller.onDownloadCreated(item());
    await vi.waitFor(() => expect(session.get('inFlight')).toEqual([7]));
    await controller.recover();
    expect(chrome.downloads.resume).not.toHaveBeenCalled();
    answer('accepted');
    await running;
    expect(chrome.downloads.cancel).toHaveBeenCalledWith(7);
  });
});

describe('a link sent with Download with Fetchdeck', () => {
  const link = { linkUrl: 'https://site.example/files/big.zip', pageUrl: 'https://site.example/page' };

  it('accepted: posts the link with the page as referer, and involves no browser download', async () => {
    const { calls, controller, client } = setup();
    await controller.onLinkClicked(link);
    expect(calls).toEqual(['post', 'wait']);
    expect(client.postCapture).toHaveBeenCalledWith({ url: link.linkUrl, cookie: 'sid=abc', referer: link.pageUrl, userAgent: 'UA/1' });
  });

  it.each([
    ['dismissed', async (c: ReturnType<typeof setup>) => { c.client.waitForOutcome.mockResolvedValueOnce('dismissed'); }],
    ['the app is down', async (c: ReturnType<typeof setup>) => { c.client.postCapture.mockRejectedValueOnce(notRunning); }],
    ['the token is wrong', async (c: ReturnType<typeof setup>) => { c.client.postCapture.mockRejectedValueOnce(wrongToken); }],
    ['the polls fail', async (c: ReturnType<typeof setup>) => { c.client.waitForOutcome.mockRejectedValueOnce(notRunning); }],
  ])('hands the link to the browser when %s, so it is never lost', async (_name, arrange) => {
    const s = setup();
    await arrange(s);
    await s.controller.onLinkClicked(link);
    expect(s.chrome.downloads.download).toHaveBeenCalledWith({ url: link.linkUrl });
    expect(s.chrome.downloads.pause).not.toHaveBeenCalled();
  });

  it('does not capture the browser download it just started as a fallback', async () => {
    const { controller, client, chrome } = setup();
    client.waitForOutcome.mockResolvedValueOnce('dismissed');
    await controller.onLinkClicked(link);
    await controller.onDownloadCreated(item({ id: 99, url: link.linkUrl }));
    expect(chrome.downloads.pause).not.toHaveBeenCalled();
    expect(client.postCapture).toHaveBeenCalledTimes(1);
    // The pass is used up: the same link downloaded again later is captured as usual.
    await controller.onDownloadCreated(item({ id: 100, url: link.linkUrl }));
    expect(chrome.downloads.pause).toHaveBeenCalledWith(100);
  });

  it('ignores links that are not http(s), and still works while automatic capture is switched off', async () => {
    const { calls, controller, client } = setup({ enabled: false, thresholdBytes: DEFAULT_THRESHOLD_BYTES });
    await controller.onLinkClicked({ linkUrl: 'javascript:alert(1)' });
    await controller.onLinkClicked({ linkUrl: 'mailto:a@b.example' });
    expect(calls).toEqual([]);
    await controller.onLinkClicked(link);
    expect(client.postCapture).toHaveBeenCalledTimes(1);
  });
});

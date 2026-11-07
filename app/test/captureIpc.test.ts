import { describe, expect, it, vi } from 'vitest';
import { registerCaptureIpc } from '../main/captureIpc';
import { createCaptureLine } from '../main/captureLine';
import type { ExtensionServer } from '../main/extensionServer';
import type { IpcMainLike, SystemLike } from '../main/ipc';
import { CHANNELS, type CaptureView } from '../shared/api';

const COOKIE = 'sid=SECRET-COOKIE';
const HEADERS = { Cookie: COOKIE, Referer: 'https://site.example/p', 'User-Agent': 'UA/1' };
const PREVIEW = { filename: 'big.zip', size: 10, rangeSupported: true, host: 'site.example', connections: 4, saveTo: '/downloads/big.zip' };

const setup = () => {
  const line = createCaptureLine();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) } as unknown as IpcMainLike;
  const queue = { add: vi.fn().mockResolvedValue('new-id') };
  let enabled = false;
  const settings = {
    get: vi.fn(() => ({ saveDir: '/downloads', maxConcurrent: 3, maxSegments: 8, notifications: true, extensionEnabled: enabled })),
    setExtensionEnabled: vi.fn((value: boolean) => {
      enabled = value;
      return Promise.resolve({ saveDir: '/downloads', maxConcurrent: 3, maxSegments: 8, notifications: true, extensionEnabled: value });
    }),
  };
  const system = { preview: vi.fn().mockResolvedValue(PREVIEW) } as unknown as SystemLike;
  let state: 'off' | 'running' | 'port-in-use' = 'off';
  const server: ExtensionServer = {
    start: vi.fn(async () => {
      state = 'running';
      return 'running' as const;
    }),
    stop: vi.fn(async () => void (state = 'off')),
    status: () => state,
    port: () => 47600,
  };
  const token = { get: vi.fn().mockResolvedValue('T'.repeat(43)), regenerate: vi.fn().mockResolvedValue('N'.repeat(43)) };
  const incoming: Array<CaptureView | null> = [];
  const registration = registerCaptureIpc({ line, queue, settings, system, token, server, ipc, onIncoming: (view) => incoming.push(view) });
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!({}, ...args));
  const submit = (extra: Partial<Parameters<typeof line.submit>[0]> = {}) => {
    const result = line.submit({ url: 'https://site.example/big.zip', headers: HEADERS, filename: 'hint.zip', size: 10, ...extra });
    if (!result.ok) throw new Error('line full');
    return result.id;
  };
  return { line, queue, settings, system, token, server, incoming, invoke, submit, handlers, registration };
};

describe('captures', () => {
  it('current shows the first pending capture and never a header', async () => {
    const { invoke, submit } = setup();
    expect(await invoke(CHANNELS.capturesCurrent)).toBeNull();
    const id = submit();
    const view = await invoke(CHANNELS.capturesCurrent);
    expect(view).toEqual({ captureId: id, url: 'https://site.example/big.zip', filename: 'hint.zip', size: 10, waiting: 0 });
    expect(JSON.stringify(view)).not.toContain('SECRET');
  });

  it('preview probes with the capture headers and returns only a LinkPreview', async () => {
    const { invoke, submit, system } = setup();
    const id = submit();
    const result = await invoke(CHANNELS.capturesPreview, id);
    expect(system.preview).toHaveBeenCalledWith('https://site.example/big.zip', '/downloads', HEADERS);
    expect(result).toEqual(PREVIEW);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('accept queues the link with its headers, then answers the extension; the filename hint is never passed on', async () => {
    const { invoke, submit, queue, line } = setup();
    const id = submit();
    await invoke(CHANNELS.capturesAccept, id);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('https://site.example/big.zip', '/downloads', { headers: HEADERS });
    expect(await line.poll(id, 0)).toBe('accepted');
  });

  it('when the queue refuses, the capture stays pending and the error reaches the page', async () => {
    const { invoke, submit, queue, line } = setup();
    queue.add.mockRejectedValueOnce(new Error('Disk is full.'));
    const id = submit();
    await expect(invoke(CHANNELS.capturesAccept, id)).rejects.toThrow('Disk is full.');
    expect(line.view()?.captureId).toBe(id);
    await invoke(CHANNELS.capturesAccept, id); // the user can try again
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('two accepts at once queue the download only once', async () => {
    const { invoke, submit, queue } = setup();
    const id = submit();
    const results = await Promise.allSettled([invoke(CHANNELS.capturesAccept, id), invoke(CHANNELS.capturesAccept, id)]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('a capture that is answered while the link is being queued does not turn a queued download into an error', async () => {
    const { invoke, submit, queue, line } = setup();
    const id = submit();
    queue.add.mockImplementationOnce(async () => {
      line.dismiss(id);
      return 'new-id';
    });
    await expect(invoke(CHANNELS.capturesAccept, id)).resolves.toBeUndefined();
  });

  it('dismiss answers the extension so the browser download resumes', async () => {
    const { invoke, submit, line, queue } = setup();
    const id = submit();
    await invoke(CHANNELS.capturesDismiss, id);
    expect(await line.poll(id, 0)).toBe('dismissed');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects ids that are not strings, and preview/accept reject ids that are gone', async () => {
    const { invoke } = setup();
    for (const channel of [CHANNELS.capturesPreview, CHANNELS.capturesAccept, CHANNELS.capturesDismiss]) {
      for (const bad of [undefined, 5, null, {}, '']) await expect(invoke(channel, bad)).rejects.toThrow('Unknown download.');
    }
    await expect(invoke(CHANNELS.capturesPreview, 'nope')).rejects.toThrow('That capture is gone.');
    await expect(invoke(CHANNELS.capturesAccept, 'nope')).rejects.toThrow('That capture is gone.');
    await expect(invoke(CHANNELS.capturesDismiss, 'nope')).resolves.toBeUndefined();
  });

  it('tells main about every change as a view without headers, and stops after dispose', async () => {
    const { submit, incoming, invoke, registration } = setup();
    const id = submit();
    expect(incoming).toEqual([{ captureId: id, url: 'https://site.example/big.zip', filename: 'hint.zip', size: 10, waiting: 0 }]);
    await invoke(CHANNELS.capturesDismiss, id);
    expect(incoming.at(-1)).toBeNull();
    registration.dispose();
    submit();
    expect(incoming).toHaveLength(2);
    expect(JSON.stringify(incoming)).not.toContain('SECRET');
  });
});

describe('extension', () => {
  it('setEnabled(true) saves the choice, starts the server and reports it; false stops it', async () => {
    const { invoke, settings, server } = setup();
    expect(await invoke(CHANNELS.extensionStatus)).toEqual({ enabled: false, state: 'off', port: 47600 });
    expect(await invoke(CHANNELS.extensionSetEnabled, true)).toEqual({ enabled: true, state: 'running', port: 47600 });
    expect(settings.setExtensionEnabled).toHaveBeenCalledWith(true);
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(await invoke(CHANNELS.extensionSetEnabled, false)).toEqual({ enabled: false, state: 'off', port: 47600 });
    expect(server.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the choice and reports port-in-use when the port is taken', async () => {
    const { invoke, server } = setup();
    vi.mocked(server.start).mockResolvedValueOnce('port-in-use');
    vi.spyOn(server, 'status').mockReturnValue('port-in-use');
    expect(await invoke(CHANNELS.extensionSetEnabled, true)).toEqual({ enabled: true, state: 'port-in-use', port: 47600 });
  });

  it('rejects a setting that is not true or false', async () => {
    const { invoke, settings } = setup();
    for (const bad of ['yes', 1, null, undefined]) await expect(invoke(CHANNELS.extensionSetEnabled, bad)).rejects.toThrow();
    expect(settings.setExtensionEnabled).not.toHaveBeenCalled();
  });

  it('serves the token on its own channels, never inside the status', async () => {
    const { invoke, token } = setup();
    expect(await invoke(CHANNELS.extensionGetToken)).toBe('T'.repeat(43));
    expect(await invoke(CHANNELS.extensionRegenerateToken)).toBe('N'.repeat(43));
    expect(token.regenerate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await invoke(CHANNELS.extensionStatus))).not.toContain('TTTT');
  });
});

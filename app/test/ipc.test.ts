import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { DownloadRecord } from '@fetchdeck/engine';
import { registerIpc, setDefaultSaveDir, type IpcMainLike, type QueueLike, type SystemLike } from '../main/ipc';
import { CHANNELS } from '../shared/api';

const record = (patch: Partial<DownloadRecord> = {}): DownloadRecord => ({
  id: 'a', url: 'http://x/f', finalUrl: 'http://x/f', filename: 'f', saveDir: '/tmp', size: 100, etag: null,
  lastModified: null, rangeSupported: true, status: 'downloading',
  segments: [{ start: 0, end: 99, downloaded: 25 }], createdAt: '2026-01-01', ...patch,
});

const setup = () => {
  const emitter = new EventEmitter();
  const records = [record()];
  const queue = Object.assign(emitter, {
    add: vi.fn().mockResolvedValue('new-id'),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(() => records),
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) };
  const send = vi.fn();
  const system: SystemLike = {
    preview: vi.fn().mockResolvedValue({ filename: 'f' }),
    openPath: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
    freeBytes: vi.fn().mockResolvedValue(1234),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  };
  registerIpc(queue as unknown as QueueLike, send, ipc as unknown as IpcMainLike, 250, system);
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
  return { queue, send, invoke, emitter, system, records };
};

describe('registerIpc', () => {
  it('routes each command to the queue', async () => {
    setDefaultSaveDir('/downloads');
    const { queue, invoke } = setup();
    await invoke(CHANNELS.add, 'http://x/f');
    await invoke(CHANNELS.pause, 'a');
    await invoke(CHANNELS.resume, 'a');
    await invoke(CHANNELS.cancel, 'a');
    await invoke(CHANNELS.remove, 'a');
    expect(queue.add).toHaveBeenCalledWith('http://x/f', '/downloads');
    expect(queue.pause).toHaveBeenCalledWith('a');
    expect(queue.resume).toHaveBeenCalledWith('a');
    expect(queue.cancel).toHaveBeenCalledWith('a');
    expect(queue.remove).toHaveBeenCalledWith('a');
  });

  it('list builds views from records and the last progress event', async () => {
    const { invoke, emitter } = setup();
    expect(await invoke(CHANNELS.list)).toMatchObject([{ id: 'a', bytesDone: 25, speed: 0 }]);
    emitter.emit('progress', 'a', { type: 'progress', bytesDone: 60, speed: 5, etaSeconds: 8 });
    expect(await invoke(CHANNELS.list)).toMatchObject([{ id: 'a', bytesDone: 60, speed: 5, etaSeconds: 8 }]);
  });

  it('status changes are sent immediately', () => {
    const { send, emitter } = setup();
    emitter.emit('changed', record({ status: 'paused' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0][0]).toMatchObject({ id: 'a', status: 'paused', speed: 0 });
  });

  it('preview, info and open-file go through the system helpers', async () => {
    setDefaultSaveDir('/downloads');
    const { invoke, system } = setup();
    expect(await invoke(CHANNELS.preview, 'http://x/f')).toEqual({ filename: 'f' });
    expect(system.preview).toHaveBeenCalledWith('http://x/f', '/downloads');
    expect(await invoke(CHANNELS.info)).toEqual({ saveDir: '/downloads', freeBytes: 1234 });
    await invoke(CHANNELS.openFile, 'a');
    expect(system.openPath).toHaveBeenCalledWith(expect.stringMatching(/tmp.f$/));
  });

  it('show in folder points at the .part file until the download is done', async () => {
    const { invoke, system, records } = setup();
    await invoke(CHANNELS.showInFolder, 'a');
    expect(system.showItemInFolder).toHaveBeenLastCalledWith(expect.stringMatching(/f\.part$/));
    records[0] = record({ status: 'done' });
    await invoke(CHANNELS.showInFolder, 'a');
    expect(system.showItemInFolder).toHaveBeenLastCalledWith(expect.stringMatching(/tmp.f$/));
  });

  it('remove-and-delete cancels a running download but deletes the file of a finished one', async () => {
    const { invoke, queue, system, records } = setup();
    await invoke(CHANNELS.removeAndDelete, 'a');
    expect(queue.cancel).toHaveBeenCalledWith('a');
    expect(system.deleteFile).not.toHaveBeenCalled();
    records[0] = record({ status: 'done' });
    await invoke(CHANNELS.removeAndDelete, 'a');
    expect(queue.remove).toHaveBeenCalledWith('a');
    expect(system.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/tmp.f$/));
  });

  it('refuses ids that are no longer in the list', async () => {
    const { invoke } = setup();
    await expect(Promise.resolve().then(() => invoke(CHANNELS.openFile, 'gone'))).rejects.toThrow(/no longer in the list/);
  });
});

describe('registerIpc argument validation', () => {
  const run = (fn: () => unknown): Promise<unknown> => Promise.resolve().then(fn);
  const badIds: [string, unknown][] = [['a number', 5], ['undefined', undefined], ['an empty string', ''], ['an object', {}]];
  const badUrls: [string, unknown][] = [
    ['a number', 5],
    ['undefined', undefined],
    ['an empty string', ''],
    ['an overlong URL', `http://x/${'a'.repeat(2048)}`],
    ['a file:// URL', 'file:///etc/passwd'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ];

  describe.each([CHANNELS.add, CHANNELS.preview])('%s', (channel) => {
    it.each(badUrls)('rejects %s', async (_name, value) => {
      const { invoke, queue, system } = setup();
      await expect(run(() => invoke(channel, value))).rejects.toThrow();
      expect(queue.add).not.toHaveBeenCalled();
      expect(system.preview).not.toHaveBeenCalled();
    });
  });

  describe.each([
    CHANNELS.pause, CHANNELS.resume, CHANNELS.cancel, CHANNELS.remove,
    CHANNELS.openFile, CHANNELS.showInFolder, CHANNELS.removeAndDelete,
  ])('%s', (channel) => {
    it.each(badIds)('rejects %s', async (_name, value) => {
      const { invoke, queue, system } = setup();
      await expect(run(() => invoke(channel, value))).rejects.toThrow();
      for (const fn of [queue.pause, queue.resume, queue.cancel, queue.remove]) expect(fn).not.toHaveBeenCalled();
      expect(system.openPath).not.toHaveBeenCalled();
      expect(system.showItemInFolder).not.toHaveBeenCalled();
      expect(system.deleteFile).not.toHaveBeenCalled();
    });
  });

  it('accepts a normal https link', async () => {
    setDefaultSaveDir('/downloads');
    const { invoke, queue } = setup();
    await invoke(CHANNELS.add, 'https://example.com/file.zip');
    expect(queue.add).toHaveBeenCalledWith('https://example.com/file.zip', '/downloads');
  });
});


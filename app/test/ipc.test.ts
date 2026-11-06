import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { DownloadRecord } from '@fetchdeck/engine';
import { registerIpc, type IpcMainLike, type QueueLike, type SettingsLike, type SystemLike } from '../main/ipc';
import { CHANNELS, type DownloadView } from '../shared/api';

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
    moveUp: vi.fn().mockResolvedValue(undefined),
    moveDown: vi.fn().mockResolvedValue(undefined),
    startNow: vi.fn().mockResolvedValue(undefined),
    setMaxConcurrent: vi.fn(),
    setMaxSegments: vi.fn(),
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
    chooseFolder: vi.fn().mockResolvedValue(null),
  };
  const stored = { saveDir: '/downloads', maxConcurrent: 3, maxSegments: 8, notifications: true };
  const settings = {
    get: vi.fn(() => stored),
    update: vi.fn((patch: object) => Promise.resolve({ ...stored, ...patch })),
    setSaveDir: vi.fn((dir: string) => Promise.resolve({ ...stored, saveDir: dir })),
  } satisfies SettingsLike;
  registerIpc(queue as unknown as QueueLike, send, ipc as unknown as IpcMainLike, 250, system, settings);
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
  return { queue, send, invoke, emitter, system, records, settings };
};

describe('registerIpc', () => {
  it('routes each command to the queue', async () => {
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

  it('moveUp, moveDown and startNow on a vanished id say it is no longer in the list', async () => {
    const { invoke, queue } = setup();
    for (const channel of [CHANNELS.moveUp, CHANNELS.moveDown, CHANNELS.startNow]) {
      await expect(Promise.resolve().then(() => invoke(channel, 'gone'))).rejects.toThrow(/no longer in the list/);
    }
    expect(queue.moveUp).not.toHaveBeenCalled();
    expect(queue.moveDown).not.toHaveBeenCalled();
    expect(queue.startNow).not.toHaveBeenCalled();
  });

  it('moveUp, moveDown and startNow route to the queue with validated ids', async () => {
    const { invoke, queue } = setup();
    await invoke(CHANNELS.moveUp, 'a');
    await invoke(CHANNELS.moveDown, 'a');
    await invoke(CHANNELS.startNow, 'a');
    expect(queue.moveUp).toHaveBeenCalledWith('a');
    expect(queue.moveDown).toHaveBeenCalledWith('a');
    expect(queue.startNow).toHaveBeenCalledWith('a');
    for (const channel of [CHANNELS.moveUp, CHANNELS.moveDown, CHANNELS.startNow]) {
      await expect(Promise.resolve().then(() => invoke(channel, 5))).rejects.toThrow();
    }
    expect(queue.moveUp).toHaveBeenCalledTimes(1);
    expect(queue.moveDown).toHaveBeenCalledTimes(1);
    expect(queue.startNow).toHaveBeenCalledTimes(1);
  });

  it('settings:get returns the store values', async () => {
    const { invoke } = setup();
    expect(await invoke(CHANNELS.settingsGet)).toEqual({ saveDir: '/downloads', maxConcurrent: 3, maxSegments: 8, notifications: true });
  });

  it('settings:update validates, saves, and applies both limits to the queue', async () => {
    const { invoke, queue, settings } = setup();
    const result = await invoke(CHANNELS.settingsUpdate, { maxConcurrent: 5, maxSegments: 4 });
    expect(settings.update).toHaveBeenCalledWith({ maxConcurrent: 5, maxSegments: 4 });
    expect(result).toMatchObject({ maxConcurrent: 5, maxSegments: 4 });
    expect(queue.setMaxConcurrent).toHaveBeenCalledWith(5);
    expect(queue.setMaxSegments).toHaveBeenCalledWith(4);
  });

  it.each([
    ['saveDir', { saveDir: '/etc' }],
    ['an unknown key', { nope: 1 }],
    ['NaN', { maxConcurrent: NaN }],
    ['a fraction', { maxSegments: 2.5 }],
    ['a string', { maxConcurrent: '3' }],
    ['zero', { maxConcurrent: 0 }],
    ['seven', { maxConcurrent: 7 }],
    ['null', null],
    ['an array', []],
    ['a non-boolean notifications', { notifications: 'yes' }],
  ])('settings:update rejects %s and calls nothing', async (_name, patch) => {
    const { invoke, queue, settings } = setup();
    await expect(Promise.resolve().then(() => invoke(CHANNELS.settingsUpdate, patch))).rejects.toThrow();
    expect(settings.update).not.toHaveBeenCalled();
    expect(queue.setMaxConcurrent).not.toHaveBeenCalled();
    expect(queue.setMaxSegments).not.toHaveBeenCalled();
  });

  it('chooseFolder returns null and changes nothing when the dialog is cancelled', async () => {
    const { invoke, system, settings } = setup();
    expect(await invoke(CHANNELS.settingsChooseFolder)).toBeNull();
    expect(system.chooseFolder).toHaveBeenCalledWith('/downloads');
    expect(settings.setSaveDir).not.toHaveBeenCalled();
  });

  it('chooseFolder passes the picked folder to settings.setSaveDir', async () => {
    const { invoke, system, settings } = setup();
    vi.mocked(system.chooseFolder).mockResolvedValue('/picked');
    expect(await invoke(CHANNELS.settingsChooseFolder)).toMatchObject({ saveDir: '/picked' });
    expect(settings.setSaveDir).toHaveBeenCalledWith('/picked');
  });

  it('every view carries its position in queue.list()', async () => {
    const { invoke, records } = setup();
    records.push(record({ id: 'b' }), record({ id: 'c' }));
    expect(await invoke(CHANNELS.list)).toMatchObject([{ id: 'a', position: 0 }, { id: 'b', position: 1 }, { id: 'c', position: 2 }]);
  });

  it("'reordered' resends views for every download with fresh positions", () => {
    const { send, emitter, records } = setup();
    records.push(record({ id: 'b' }));
    records.reverse();
    emitter.emit('reordered', ['b', 'a']);
    const sent = send.mock.calls.flatMap((call) => call[0] as DownloadView[]);
    expect(sent).toMatchObject([{ id: 'b', position: 0 }, { id: 'a', position: 1 }]);
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
    CHANNELS.moveUp, CHANNELS.moveDown, CHANNELS.startNow,
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
    const { invoke, queue } = setup();
    await invoke(CHANNELS.add, 'https://example.com/file.zip');
    expect(queue.add).toHaveBeenCalledWith('https://example.com/file.zip', '/downloads');
  });
});


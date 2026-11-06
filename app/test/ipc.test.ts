import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { DownloadRecord } from '@fetchdeck/engine';
import { registerIpc, setDefaultSaveDir, type IpcMainLike, type QueueLike } from '../main/ipc';
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
  registerIpc(queue as unknown as QueueLike, send, ipc as unknown as IpcMainLike, 250);
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
  return { queue, send, invoke, emitter };
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
});

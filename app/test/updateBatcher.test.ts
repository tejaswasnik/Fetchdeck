import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdateBatcher } from '../main/updateBatcher';
import type { DownloadView } from '../shared/api';

const view = (id: string, bytesDone: number, status: DownloadView['status'] = 'downloading'): DownloadView => ({
  id, url: 'http://x/f', finalUrl: 'http://x/f', filename: 'f', saveDir: '/tmp', size: 100, etag: null,
  lastModified: null, rangeSupported: true, status, segments: [], createdAt: '2026-01-01',
  bytesDone, speed: 0, etaSeconds: null, position: 0,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createUpdateBatcher', () => {
  it('many progress calls within 250 ms give one send', () => {
    const send = vi.fn();
    const batcher = createUpdateBatcher(send);
    for (let i = 1; i <= 50; i++) batcher.progress(view('a', i));
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toEqual([view('a', 50)]);
  });

  it('status sends immediately with pending progress merged', () => {
    const send = vi.fn();
    const batcher = createUpdateBatcher(send);
    batcher.progress(view('a', 10));
    batcher.progress(view('b', 20));
    batcher.status(view('a', 100, 'done'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toEqual([view('a', 100, 'done'), view('b', 20)]);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stop drops pending updates', () => {
    const send = vi.fn();
    const batcher = createUpdateBatcher(send);
    batcher.progress(view('a', 1));
    batcher.stop();
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
  });
});

import type { DownloadRecord } from '@fetchdeck/engine';
import { describe, expect, it, vi } from 'vitest';
import { createNotifier, type NotifierDeps } from '../main/notifier';

const record = (status: DownloadRecord['status'], over: Partial<DownloadRecord> = {}): DownloadRecord => ({
  id: 'a',
  url: 'http://x/f.bin',
  finalUrl: 'http://x/f.bin',
  filename: 'f.bin',
  saveDir: '/tmp',
  size: 10,
  etag: null,
  lastModified: null,
  rangeSupported: true,
  status,
  segments: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const setup = (over: Partial<NotifierDeps> = {}) => {
  const shown: { title: string; body: string; onClick: () => void }[] = [];
  const deps: NotifierDeps = {
    enabled: () => true,
    isSupported: () => true,
    isWindowFocused: () => false,
    show: (n) => shown.push(n),
    showFile: vi.fn(),
    revealWindow: vi.fn(),
    ...over,
  };
  return { notifier: createNotifier(deps), shown, deps };
};

describe('notifier', () => {
  it('notifies once when a running download becomes done', () => {
    const { notifier, shown } = setup();
    notifier.onChanged(record('downloading'));
    notifier.onChanged(record('done'));
    notifier.onChanged(record('done'));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: 'Download complete', body: 'f.bin' });
  });

  it('notifies once when a download becomes error, with the message', () => {
    const { notifier, shown } = setup();
    notifier.onChanged(record('downloading'));
    notifier.onChanged(record('error', { error: 'boom' }));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: 'Download failed', body: 'f.bin: boom' });
  });

  it('does not notify for the first status it sees (restored records)', () => {
    const { notifier, shown } = setup();
    notifier.onChanged(record('done'));
    notifier.onChanged(record('error', { id: 'b', error: 'x' }));
    expect(shown).toHaveLength(0);
  });

  it('does not notify again for a repeated changed event with the same status', () => {
    const { notifier, shown } = setup();
    notifier.onChanged(record('downloading'));
    notifier.onChanged(record('downloading'));
    notifier.onChanged(record('error', { error: 'a' }));
    notifier.onChanged(record('error', { error: 'a' }));
    expect(shown).toHaveLength(1);
  });

  it.each([
    ['focused', { isWindowFocused: () => true }],
    ['disabled', { enabled: () => false }],
    ['unsupported', { isSupported: () => false }],
  ])('does not notify when %s', (_name, over) => {
    const { notifier, shown } = setup(over);
    notifier.onChanged(record('downloading'));
    notifier.onChanged(record('done'));
    expect(shown).toHaveLength(0);
  });

  it('a resumed download that finishes later notifies once', () => {
    const { notifier, shown } = setup();
    notifier.onChanged(record('paused'));
    notifier.onChanged(record('queued'));
    notifier.onChanged(record('downloading'));
    notifier.onChanged(record('done'));
    expect(shown).toHaveLength(1);
  });

  it('clicking a done notification calls showFile; clicking an error calls revealWindow', () => {
    const { notifier, shown, deps } = setup();
    const done = record('done');
    notifier.onChanged(record('downloading'));
    notifier.onChanged(done);
    shown[0]?.onClick();
    expect(deps.showFile).toHaveBeenCalledWith(done);
    expect(deps.revealWindow).not.toHaveBeenCalled();

    const failed = record('error', { id: 'b', error: 'x' });
    notifier.onChanged(record('downloading', { id: 'b' }));
    notifier.onChanged(failed);
    shown[1]?.onClick();
    expect(deps.revealWindow).toHaveBeenCalledTimes(1);
    expect(deps.showFile).toHaveBeenCalledTimes(1);
  });
});

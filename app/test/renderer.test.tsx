// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddDownloadDialog } from '../renderer/components/AddDownloadDialog';
import { DownloadRow } from '../renderer/components/DownloadRow';
import { SegmentBar } from '../renderer/components/SegmentBar';
import { queuePosition, queuedCount } from '../renderer/model';
import { useDownloads } from '../renderer/useDownloads';
import { formatBytes, formatEta, formatOffset, formatProgress, ordinal } from '../renderer/format';
import type { DownloadView, LinkPreview } from '../shared/api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = (patch: Partial<DownloadView> = {}): DownloadView => ({
  id: 'a', url: 'http://x/f.zip', finalUrl: 'http://x/f.zip', filename: 'f.zip', saveDir: '/tmp', size: 1000,
  etag: null, lastModified: null, rangeSupported: true, status: 'downloading', segments: [],
  createdAt: '2026-01-01T10:00:00Z', bytesDone: 500, speed: 1536, etaSeconds: 5, position: 0, ...patch,
});

const handlers = () => ({ onPause: vi.fn(), onResume: vi.fn(), onOpen: vi.fn() });

describe('format', () => {
  it('formatBytes, formatEta and friends', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatEta(null)).toBe('--');
    expect(formatEta(5)).toBe('5 s');
    expect(formatEta(168)).toBe('2 m 48 s');
    expect(formatEta(3720)).toBe('1 h 2 m');
    const GB = 1024 ** 3;
    expect(formatProgress(4.06 * GB, 5.78 * GB)).toBe('4.06 / 5.78 GB');
    expect(formatProgress(37.8 * 1024 ** 2, 98.4 * 1024 ** 2)).toBe('37.8 / 98.4 MB');
    expect(formatOffset(0.72 * GB, 5.78 * GB)).toBe('0.72');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
  });
});

describe('DownloadRow', () => {
  it('shows Pause when downloading, Resume when paused', () => {
    const h = handlers();
    const { rerender } = render(<DownloadRow download={view()} {...h} />);
    expect(screen.queryByText('Pause')).not.toBeNull();
    expect(screen.queryByText('Resume')).toBeNull();
    rerender(<DownloadRow download={view({ status: 'paused' })} {...h} />);
    expect(screen.queryByText('Resume')).not.toBeNull();
    expect(screen.queryByText('Pause')).toBeNull();
    fireEvent.click(screen.getByText('Resume'));
    expect(h.onResume).toHaveBeenCalledWith('a');
  });

  it('shows the error as a pill and a Retry button that calls resume', () => {
    const h = handlers();
    render(<DownloadRow download={view({ status: 'error', error: 'File not found (404)' })} {...h} />);
    expect(screen.queryByText('File not found (404)')).not.toBeNull();
    fireEvent.click(screen.getByText('Retry'));
    expect(h.onResume).toHaveBeenCalledWith('a');
  });

  it('shows the non-resumable note and offers Restart when paused', () => {
    const h = handlers();
    render(<DownloadRow download={view({ status: 'paused', rangeSupported: false })} {...h} />);
    expect(screen.queryByText(/Can't resume: the server doesn't support it/)).not.toBeNull();
    fireEvent.click(screen.getByText('Restart'));
    expect(h.onResume).toHaveBeenCalledWith('a');
  });

  it('finished rows offer Open; queued rows show their place in line', () => {
    const h = handlers();
    const { rerender } = render(<DownloadRow download={view({ status: 'done' })} {...h} />);
    fireEvent.click(screen.getByText('Open'));
    expect(h.onOpen).toHaveBeenCalledWith('a');
    rerender(<DownloadRow download={view({ status: 'queued' })} position={1} {...h} />);
    expect(screen.queryByText('Next in line')).not.toBeNull();
    rerender(<DownloadRow download={view({ status: 'queued' })} position={2} {...h} />);
    expect(screen.queryByText('2nd in line')).not.toBeNull();
  });

  it('clicking a row selects it', () => {
    const onSelect = vi.fn();
    render(<DownloadRow download={view()} onSelect={onSelect} {...handlers()} />);
    fireEvent.click(screen.getByText('f.zip'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});

describe('SegmentBar', () => {
  it('draws one dash per byte range, filled by progress', () => {
    const segments = [
      { start: 0, end: 99, downloaded: 100 },
      { start: 100, end: 199, downloaded: 50 },
    ];
    const { container } = render(<SegmentBar segments={segments} percent={75} live />);
    const fills = [...container.querySelectorAll<HTMLElement>('.segbar__fill')].map((el) => el.style.width);
    expect(fills).toEqual(['100%', '50%']);
  });
});

describe('AddDownloadDialog', () => {
  const preview: LinkPreview = {
    filename: 'OBS.exe', size: 140 * 1024 * 1024, rangeSupported: true, host: 'objects.example.com',
    connections: 8, saveTo: 'D:\\Downloads\\OBS.exe',
  };
  const stubApi = (impl: () => Promise<LinkPreview>) =>
    vi.stubGlobal('window', Object.assign(window, { downloads: { preview: vi.fn(impl) } }));

  it('checks the link, shows what will be downloaded, then adds it to the queue', async () => {
    stubApi(() => Promise.resolve(preview));
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AddDownloadDialog url="http://x/OBS.exe" onAdd={onAdd} onClose={onClose} />);
    expect(screen.getByText('Checking the link…')).not.toBeNull();
    expect(await screen.findByText('OBS.exe')).not.toBeNull();
    expect(screen.queryByText('D:\\Downloads\\OBS.exe')).not.toBeNull();
    fireEvent.click(screen.getByText('Add to queue'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('http://x/OBS.exe'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows why a link was rejected and does not allow adding it', async () => {
    stubApi(() => Promise.reject(new Error('Only http and https links are supported')));
    render(<AddDownloadDialog url="ftp://x" onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Only http');
    expect((screen.getByText('Add to queue') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the error when the queue refuses the link', async () => {
    stubApi(() => Promise.resolve(preview));
    const onAdd = vi.fn().mockRejectedValue(new Error('Could not add'));
    render(<AddDownloadDialog url="http://x/f" onAdd={onAdd} onClose={vi.fn()} />);
    await screen.findByText('OBS.exe');
    fireEvent.click(screen.getByText('Add to queue'));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not add');
  });
});

describe('queue order in the renderer', () => {
  const a = view({ id: 'a', status: 'queued', createdAt: '2026-01-01T10:00:00Z', position: 2 });
  const b = view({ id: 'b', status: 'queued', createdAt: '2026-01-01T10:01:00Z', position: 1 });

  it('queuePosition follows position, not createdAt', () => {
    expect(queuePosition([a, b], 'b')).toBe(1);
    expect(queuePosition([a, b], 'a')).toBe(2);
  });

  it('queuedCount counts only queued items', () => {
    expect(queuedCount([a, b, view({ id: 'c', status: 'downloading' }), view({ id: 'd', status: 'done' })])).toBe(2);
    expect(queuedCount([])).toBe(0);
  });

  const stubDownloads = (initial: DownloadView[]) => {
    let push: (changed: DownloadView[]) => void = () => undefined;
    const api = {
      list: vi.fn().mockResolvedValue(initial),
      onUpdate: vi.fn((cb: (changed: DownloadView[]) => void) => {
        push = cb;
        return () => undefined;
      }),
      moveUp: vi.fn().mockResolvedValue(undefined),
      moveDown: vi.fn().mockResolvedValue(undefined),
      startNow: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('window', Object.assign(window, { downloads: api }));
    return { api, push: (changed: DownloadView[]) => push(changed) };
  };

  it('useDownloads sorts by position and re-sorts when an update changes positions', async () => {
    const { push } = stubDownloads([a, b]);
    const { result } = renderHook(() => useDownloads());
    await waitFor(() => expect(result.current.downloads.map((d) => d.id)).toEqual(['b', 'a']));
    act(() => push([{ ...a, position: 0 }, { ...b, position: 5 }]));
    expect(result.current.downloads.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('actions.moveUp, moveDown and startNow call the matching window.downloads method', async () => {
    const { api } = stubDownloads([]);
    const { result } = renderHook(() => useDownloads());
    await result.current.actions.moveUp('a');
    await result.current.actions.moveDown('b');
    await result.current.actions.startNow('c');
    expect(api.moveUp).toHaveBeenCalledWith('a');
    expect(api.moveDown).toHaveBeenCalledWith('b');
    expect(api.startNow).toHaveBeenCalledWith('c');
  });
});

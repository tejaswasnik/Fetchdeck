// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../renderer/App';
import { AddDownloadDialog } from '../renderer/components/AddDownloadDialog';
import { SettingsDialog } from '../renderer/components/SettingsDialog';
import { DownloadRow } from '../renderer/components/DownloadRow';
import { SegmentBar } from '../renderer/components/SegmentBar';
import { queuePosition, queuedCount } from '../renderer/model';
import { useDownloads } from '../renderer/useDownloads';
import { formatBytes, formatEta, formatOffset, formatProgress, ordinal } from '../renderer/format';
import type { DownloadView, LinkPreview, Settings, SettingsPatch } from '../shared/api';

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

describe('SettingsDialog', () => {
  const saved: Settings = { saveDir: 'D:\Downloads', maxConcurrent: 3, maxSegments: 8, notifications: true };
  const stubSettings = () => {
    const api = {
      getSettings: vi.fn<() => Promise<Settings>>().mockResolvedValue(saved),
      updateSettings: vi.fn<(patch: SettingsPatch) => Promise<Settings>>(),
      chooseFolder: vi.fn<() => Promise<Settings | null>>().mockResolvedValue(null),
    };
    vi.stubGlobal('window', Object.assign(window, { downloads: api }));
    return api;
  };
  const open = async (onClose = vi.fn(), onSaveDirChanged = vi.fn()) => {
    render(<SettingsDialog onClose={onClose} onSaveDirChanged={onSaveDirChanged} />);
    await screen.findByText(saved.saveDir);
    return { onClose, onSaveDirChanged };
  };
  const stepper = (name: string) => within(screen.getByRole('group', { name }));
  const SIMULTANEOUS = 'Simultaneous downloads';
  const CONNECTIONS = 'Connections per download';

  it('shows the saved values: folder path, steppers at 3 and 8, notifications on', async () => {
    stubSettings();
    await open();
    expect(screen.getByText('D:\Downloads')).not.toBeNull();
    expect(stepper(SIMULTANEOUS).getByRole('spinbutton').textContent).toBe('3');
    expect(stepper(CONNECTIONS).getByRole('spinbutton').textContent).toBe('8');
    expect(screen.getByRole('switch', { name: 'Notifications' }).getAttribute('aria-checked')).toBe('true');
  });

  it('stepper buttons send the right patch and show the returned value', async () => {
    const api = stubSettings();
    api.updateSettings.mockResolvedValue({ ...saved, maxConcurrent: 4 });
    await open();
    fireEvent.click(stepper(SIMULTANEOUS).getByRole('button', { name: 'Increase' }));
    await waitFor(() => expect(stepper(SIMULTANEOUS).getByRole('spinbutton').textContent).toBe('4'));
    expect(api.updateSettings).toHaveBeenCalledWith({ maxConcurrent: 4 });
    api.updateSettings.mockResolvedValue({ ...saved, maxConcurrent: 4, maxSegments: 7 });
    fireEvent.click(stepper(CONNECTIONS).getByRole('button', { name: 'Decrease' }));
    await waitFor(() => expect(stepper(CONNECTIONS).getByRole('spinbutton').textContent).toBe('7'));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ maxSegments: 7 });
  });

  it('steppers stop at 1 and 6 (simultaneous) and 1 and 8 (connections)', async () => {
    const api = stubSettings();
    api.getSettings.mockResolvedValue({ ...saved, maxConcurrent: 6, maxSegments: 1 });
    await open();
    const isDisabled = (name: string, label: string) =>
      (stepper(name).getByRole('button', { name: label }) as HTMLButtonElement).disabled;
    expect(isDisabled(SIMULTANEOUS, 'Increase')).toBe(true);
    expect(isDisabled(SIMULTANEOUS, 'Decrease')).toBe(false);
    expect(isDisabled(CONNECTIONS, 'Decrease')).toBe(true);
    expect(isDisabled(CONNECTIONS, 'Increase')).toBe(false);
    cleanup();
    api.getSettings.mockResolvedValue({ ...saved, maxConcurrent: 1, maxSegments: 8 });
    await open();
    expect(isDisabled(SIMULTANEOUS, 'Decrease')).toBe(true);
    expect(isDisabled(CONNECTIONS, 'Increase')).toBe(true);
  });

  it('the notifications switch sends { notifications: false }', async () => {
    const api = stubSettings();
    api.updateSettings.mockResolvedValue({ ...saved, notifications: false });
    await open();
    fireEvent.click(screen.getByRole('switch', { name: 'Notifications' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notifications' }).getAttribute('aria-checked')).toBe('false'));
    expect(api.updateSettings).toHaveBeenCalledWith({ notifications: false });
  });

  it('a rejected update shows the message inline and snaps back to the saved value', async () => {
    stubSettings().updateSettings.mockRejectedValue(new Error('Nope'));
    await open();
    fireEvent.click(stepper(SIMULTANEOUS).getByRole('button', { name: 'Increase' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nope');
    expect(stepper(SIMULTANEOUS).getByRole('spinbutton').textContent).toBe('3');
  });

  it('Change... calls chooseFolder, shows the new path, and calls onSaveDirChanged; a null result changes nothing', async () => {
    const api = stubSettings();
    const { onSaveDirChanged } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    await waitFor(() => expect(api.chooseFolder).toHaveBeenCalledTimes(1));
    expect(onSaveDirChanged).not.toHaveBeenCalled();
    expect(screen.getByText('D:\Downloads')).not.toBeNull();
    api.chooseFolder.mockResolvedValue({ ...saved, saveDir: 'E:\Videos' });
    fireEvent.click(screen.getByRole('button', { name: 'Change…' }));
    expect(await screen.findByText('E:\Videos')).not.toBeNull();
    expect(onSaveDirChanged).toHaveBeenCalledTimes(1);
  });

  it('Esc closes the dialog and focus stays inside it while open', async () => {
    stubSettings();
    const { onClose } = await open();
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "Applies to new downloads" under folder and connections, "Applies right away" under simultaneous', async () => {
    stubSettings();
    await open();
    expect(screen.getAllByText('Applies to new downloads')).toHaveLength(2);
    expect(screen.getAllByText('Applies right away')).toHaveLength(1);
    expect(within(screen.getByRole('group', { name: SIMULTANEOUS }).parentElement as HTMLElement).queryByText('Applies right away')).not.toBeNull();
  });
});

describe('reorder menu items and shortcuts', () => {
  const rows = [
    view({ id: 'q1', filename: 'one.zip', status: 'queued', position: 1 }),
    view({ id: 'q2', filename: 'two.zip', status: 'queued', position: 2 }),
    view({ id: 'q3', filename: 'three.zip', status: 'queued', position: 3 }),
    view({ id: 'p1', filename: 'paused.zip', status: 'paused', position: 4 }),
    view({ id: 'e1', filename: 'err.zip', status: 'error', position: 5 }),
    view({ id: 'r1', filename: 'run.zip', status: 'downloading', position: 6 }),
    view({ id: 'd1', filename: 'done.zip', status: 'done', position: 7 }),
  ];
  const mount = async () => {
    const api = {
      list: vi.fn().mockResolvedValue(rows),
      onUpdate: vi.fn().mockReturnValue(() => undefined),
      info: vi.fn().mockResolvedValue({ saveDir: '/tmp', freeBytes: null }),
      moveUp: vi.fn().mockResolvedValue(undefined),
      moveDown: vi.fn().mockResolvedValue(undefined),
      startNow: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('window', Object.assign(window, { downloads: api }));
    render(<App />);
    await screen.findAllByRole('button', { name: 'More actions' });
    return api;
  };
  const openMenu = async (index: number) => {
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[index]);
    return screen.findByRole('menu');
  };
  const item = (name: string) => screen.getByRole('menuitem', { name: new RegExp(name) });
  const has = (name: string) => screen.queryByRole('menuitem', { name: new RegExp(name) }) !== null;

  it('queued item: menu shows Move up, Move down and Start now', async () => {
    await mount();
    await openMenu(1);
    expect(has('Move up')).toBe(true);
    expect(has('Move down')).toBe(true);
    expect(has('Start now')).toBe(true);
    expect(item('Move up').hasAttribute('disabled')).toBe(false);
    expect(item('Move down').hasAttribute('disabled')).toBe(false);
  });

  it('the first queued item has Move up disabled; the last has Move down disabled', async () => {
    await mount();
    await openMenu(0);
    expect(item('Move up').hasAttribute('disabled')).toBe(true);
    expect(item('Move down').hasAttribute('disabled')).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await openMenu(2);
    expect(item('Move up').hasAttribute('disabled')).toBe(false);
    expect(item('Move down').hasAttribute('disabled')).toBe(true);
  });

  it('paused and errored items show Start now but not Move up or Move down', async () => {
    await mount();
    for (const index of [3, 4]) {
      await openMenu(index);
      expect(has('Start now')).toBe(true);
      expect(has('Move up')).toBe(false);
      expect(has('Move down')).toBe(false);
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
  });

  it('downloading and done items show none of the three', async () => {
    await mount();
    for (const index of [5, 6]) {
      await openMenu(index);
      expect(has('Start now')).toBe(false);
      expect(has('Move up')).toBe(false);
      expect(has('Move down')).toBe(false);
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
  });

  it('menu items call their handlers and close the menu', async () => {
    const api = await mount();
    await openMenu(1);
    fireEvent.click(item('Move up'));
    expect(api.moveUp).toHaveBeenCalledWith('q2');
    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu(1);
    fireEvent.click(item('Move down'));
    expect(api.moveDown).toHaveBeenCalledWith('q2');
    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu(1);
    fireEvent.click(item('Start now'));
    expect(api.startNow).toHaveBeenCalledWith('q2');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a disabled item does nothing and keeps the menu open', async () => {
    const api = await mount();
    await openMenu(0);
    fireEvent.click(item('Move up'));
    expect(api.moveUp).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(item('Move up').querySelector('svg')?.getAttribute('class')).toBe('menu__icon--up');
    expect(item('Move up').querySelector('span > span')).toBeNull();
  });

  it('Alt+ArrowUp / Alt+ArrowDown move the selected queued item', async () => {
    const api = await mount();
    fireEvent.click(screen.getByText('two.zip'));
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true });
    expect(api.moveUp).toHaveBeenCalledWith('q2');
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(api.moveDown).toHaveBeenCalledWith('q2');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(api.moveDown).toHaveBeenCalledTimes(1);
  });

  it('Alt+Arrow is ignored while typing in an input and for non-queued items', async () => {
    const api = await mount();
    fireEvent.click(screen.getByText('two.zip'));
    const input = screen.getAllByRole('textbox')[0];
    fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true });
    expect(api.moveUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('run.zip'));
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(api.moveUp).not.toHaveBeenCalled();
    expect(api.moveDown).not.toHaveBeenCalled();
  });
});

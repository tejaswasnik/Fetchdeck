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
import type { CaptureView, DownloadView, ExtensionStatus, LinkPreview, Settings, SettingsPatch } from '../shared/api';

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

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const stubExtension = (status: ExtensionStatus = { enabled: false, state: 'off', port: 47600 }) => ({
  getStatus: vi.fn<() => Promise<ExtensionStatus>>().mockResolvedValue(status),
  setEnabled: vi.fn<(enabled: boolean) => Promise<ExtensionStatus>>(),
  getToken: vi.fn<() => Promise<string>>().mockResolvedValue(TOKEN),
  regenerateToken: vi.fn<() => Promise<string>>().mockResolvedValue('N'.repeat(43)),
});

const PREVIEW: LinkPreview = { filename: 'big.zip', size: 6_000_000, rangeSupported: true, host: 'site.example', connections: 4, saveTo: 'D:\\Downloads\\big.zip' };
const CAPTURE: CaptureView = { captureId: 'c1', url: 'https://site.example/big.zip', filename: 'hint.zip', size: 6_000_000, waiting: 0 };

// The captures bridge as the page sees it: `push` plays the part of main telling the page the line changed.
const stubCaptures = (first: CaptureView | null = null) => {
  let push: (view: CaptureView | null) => void = () => undefined;
  const api = {
    current: vi.fn().mockResolvedValue(first),
    onIncoming: vi.fn((cb: (view: CaptureView | null) => void) => {
      push = cb;
      return () => undefined;
    }),
    preview: vi.fn<(id: string) => Promise<LinkPreview>>().mockResolvedValue(PREVIEW),
    accept: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    dismiss: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
  };
  return { api, push: (view: CaptureView | null) => act(() => push(view)) };
};

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
  const saved: Settings = { saveDir: 'D:\Downloads', maxConcurrent: 3, maxSegments: 8, notifications: true, extensionEnabled: false };
  const stubSettings = () => {
    const api = {
      getSettings: vi.fn<() => Promise<Settings>>().mockResolvedValue(saved),
      updateSettings: vi.fn<(patch: SettingsPatch) => Promise<Settings>>(),
      chooseFolder: vi.fn<() => Promise<Settings | null>>().mockResolvedValue(null),
    };
    vi.stubGlobal('window', Object.assign(window, { downloads: api, extension: stubExtension() }));
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
    vi.stubGlobal('window', Object.assign(window, { downloads: api, captures: stubCaptures().api }));
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

describe('AddDownloadDialog for a capture from the browser', () => {
  const mountCapture = (capture: CaptureView = { ...CAPTURE, waiting: 2 }) => {
    const { api } = stubCaptures();
    const downloads = { preview: vi.fn() };
    vi.stubGlobal('window', Object.assign(window, { captures: api, downloads }));
    const onClose = vi.fn();
    const onAdd = vi.fn();
    render(<AddDownloadDialog url={capture.url} capture={capture} onAdd={onAdd} onClose={onClose} />);
    return { api, downloads, onClose, onAdd };
  };

  it('shows the From browser tag, how many more are waiting, and the preview from the capture (not from the link)', async () => {
    const { api, downloads } = mountCapture();
    expect(screen.getByText('From browser')).not.toBeNull();
    expect(screen.getByText('2 more waiting')).not.toBeNull();
    expect(screen.getByText(CAPTURE.url)).not.toBeNull();
    expect(await screen.findByText('big.zip')).not.toBeNull();
    expect(api.preview).toHaveBeenCalledWith('c1');
    expect(downloads.preview).not.toHaveBeenCalled();
  });

  it('says nothing about waiting captures when there are none, and a pasted link has no From browser tag', async () => {
    mountCapture({ ...CAPTURE, waiting: 0 });
    expect(screen.queryByText(/more waiting/)).toBeNull();
    cleanup();
    vi.stubGlobal('window', Object.assign(window, { downloads: { preview: vi.fn().mockResolvedValue(PREVIEW) } }));
    render(<AddDownloadDialog url="http://x/f" onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText('From browser')).toBeNull();
  });

  it('Download accepts the capture by id and closes', async () => {
    const { api, onClose, onAdd } = mountCapture();
    await screen.findByText('big.zip');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(api.accept).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.dismiss).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it.each([
    ['the Download in browser button', () => fireEvent.click(screen.getByRole('button', { name: 'Download in browser' }))],
    ['Esc', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['the close button', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['a click on the overlay', () => fireEvent.mouseDown(document.querySelector('.overlay') as Element)],
  ])('%s dismisses the capture once, so the browser carries on', async (_name, trigger) => {
    const { api, onClose } = mountCapture();
    trigger();
    trigger();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.dismiss).toHaveBeenCalledTimes(1);
    expect(api.dismiss).toHaveBeenCalledWith('c1');
    expect(api.accept).not.toHaveBeenCalled();
  });

  it('a refused accept shows the message and keeps the dialog open', async () => {
    const { api, onClose } = mountCapture();
    api.accept.mockRejectedValue(new Error('Disk is full.'));
    await screen.findByText('big.zip');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Disk is full.');
    expect(onClose).not.toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
  });

  it('when the link cannot be read, Download is off but Download in browser still works', async () => {
    const { api, onClose } = mountCapture();
    api.preview.mockRejectedValue(new Error('The server said no.'));
    cleanup();
    render(<AddDownloadDialog url={CAPTURE.url} capture={CAPTURE} onAdd={vi.fn()} onClose={onClose} />);
    expect((await screen.findByRole('alert')).textContent).toContain('The server said no.');
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Download in browser' }));
    await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith('c1'));
  });
});

describe('the app and captures from the browser', () => {
  const mountApp = async (first: CaptureView | null = null) => {
    const captures = stubCaptures(first);
    const downloads = {
      list: vi.fn().mockResolvedValue([]),
      onUpdate: vi.fn().mockReturnValue(() => undefined),
      info: vi.fn().mockResolvedValue({ saveDir: '/tmp', freeBytes: null }),
    };
    vi.stubGlobal('window', Object.assign(window, { downloads, captures: captures.api }));
    render(<App />);
    await waitFor(() => expect(captures.api.current).toHaveBeenCalled());
    return captures;
  };
  const HANDLED = 'That download was already handled by your browser.';

  it('opens the dialog when the line delivers a capture, and closes it quietly when the user acted', async () => {
    const captures = await mountApp();
    expect(screen.queryByRole('dialog', { name: 'Add download' })).toBeNull();
    captures.push(CAPTURE);
    expect(await screen.findByText('From browser')).not.toBeNull();
    await screen.findByText('big.zip');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Add download' })).getByRole('button', { name: 'Download' }));
    captures.push(null); // main answers the line before the reply to accept comes back
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add download' })).toBeNull());
    expect(screen.queryByText(HANDLED)).toBeNull();
  });

  it('shows a capture that was already waiting when the window opened', async () => {
    await mountApp(CAPTURE);
    expect(await screen.findByText('From browser')).not.toBeNull();
  });

  it('closes the dialog with a short note when the capture goes away without the user acting', async () => {
    const captures = await mountApp();
    captures.push(CAPTURE);
    await screen.findByText('From browser');
    captures.push(null);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add download' })).toBeNull());
    expect(screen.getByText(HANDLED)).not.toBeNull();
  });

  it('moves on to the next capture, and the one the user just answered does not wipe it', async () => {
    const captures = await mountApp();
    captures.push({ ...CAPTURE, waiting: 1 });
    await screen.findByText('1 more waiting');
    fireEvent.click(screen.getByRole('button', { name: 'Download in browser' }));
    captures.push({ captureId: 'c2', url: 'https://site.example/two.zip', filename: null, size: null, waiting: 0 });
    expect(await screen.findByText('https://site.example/two.zip')).not.toBeNull();
    await waitFor(() => expect(captures.api.dismiss).toHaveBeenCalledWith('c1'));
    expect(screen.getByText('https://site.example/two.zip')).not.toBeNull();
    expect(screen.queryByText(HANDLED)).toBeNull();
  });
});

describe('SettingsDialog browser extension section', () => {
  const saved: Settings = { saveDir: 'D:\\Downloads', maxConcurrent: 3, maxSegments: 8, notifications: true, extensionEnabled: false };
  const mountSettings = async (status?: ExtensionStatus) => {
    const extension = stubExtension(status);
    const downloads = { getSettings: vi.fn().mockResolvedValue(saved), updateSettings: vi.fn(), chooseFolder: vi.fn() };
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', Object.assign(navigator, { clipboard }));
    vi.stubGlobal('window', Object.assign(window, { downloads, extension }));
    render(<SettingsDialog onClose={vi.fn()} onSaveDirChanged={vi.fn()} />);
    await screen.findByRole('switch', { name: 'Browser extension' });
    return { extension, clipboard };
  };
  const RUNNING: ExtensionStatus = { enabled: true, state: 'running', port: 47600 };

  it('the switch turns the extension on through the bridge and shows the status text', async () => {
    const { extension } = await mountSettings();
    expect(screen.getByRole('switch', { name: 'Browser extension' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Off')).not.toBeNull();
    extension.setEnabled.mockResolvedValue(RUNNING);
    fireEvent.click(screen.getByRole('switch', { name: 'Browser extension' }));
    expect(await screen.findByText('Running on 127.0.0.1:47600')).not.toBeNull();
    expect(extension.setEnabled).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch', { name: 'Browser extension' }).getAttribute('aria-checked')).toBe('true');
  });

  it('says so when the port is taken, and the switch can be turned off again', async () => {
    const { extension } = await mountSettings({ enabled: true, state: 'port-in-use', port: 47600 });
    expect(screen.getByText("Port 47600 can't be used. Another program may be using it")).not.toBeNull();
    extension.setEnabled.mockResolvedValue({ enabled: false, state: 'off', port: 47600 });
    fireEvent.click(screen.getByRole('switch', { name: 'Browser extension' }));
    await waitFor(() => expect(extension.setEnabled).toHaveBeenCalledWith(false));
    expect(await screen.findByText('Off')).not.toBeNull();
  });

  it('a refused switch shows the message and leaves the switch where it was', async () => {
    const { extension } = await mountSettings();
    extension.setEnabled.mockRejectedValue(new Error('Could not start.'));
    fireEvent.click(screen.getByRole('switch', { name: 'Browser extension' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not start.');
    expect(screen.getByRole('switch', { name: 'Browser extension' }).getAttribute('aria-checked')).toBe('false');
  });

  it('keeps the token hidden until Show, hides it again, and does not fetch it before it is needed', async () => {
    const { extension } = await mountSettings(RUNNING);
    expect(screen.queryByText(TOKEN)).toBeNull();
    expect(extension.getToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText(TOKEN)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText(TOKEN)).toBeNull();
  });

  it('Copy puts the token on the clipboard without showing it', async () => {
    const { clipboard } = await mountSettings(RUNNING);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(TOKEN));
    expect(screen.queryByText(TOKEN)).toBeNull();
    expect(await screen.findByText('Copied')).not.toBeNull();
  });

  it('Regenerate asks first, and only a yes replaces the token', async () => {
    const { extension } = await mountSettings(RUNNING);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(extension.regenerateToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(extension.regenerateToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, regenerate' }));
    await waitFor(() => expect(extension.regenerateToken).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Yes, regenerate' })).toBeNull();
  });

  it('when the token was showing, Regenerate shows the new one', async () => {
    await mountSettings(RUNNING);
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await screen.findByText(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, regenerate' }));
    expect(await screen.findByText('N'.repeat(43))).not.toBeNull();
    expect(screen.queryByText(TOKEN)).toBeNull();
  });

  it('has no token controls while the extension is off, but always says how to install it', async () => {
    await mountSettings();
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    const help = screen.getByText(/extension\/dist/).textContent ?? '';
    expect(help).toContain('Developer mode');
    expect(help).toContain('Load unpacked');
  });
});

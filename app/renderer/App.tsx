import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, CaptureView } from '../shared/api';
import { AddDownloadDialog } from './components/AddDownloadDialog';
import { DetailsPanel } from './components/DetailsPanel';
import { DownloadList } from './components/DownloadList';
import { RowMenu } from './components/RowMenu';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import { FILTERS, isActive, matchesFilter, queuedCount, queuePosition, type Filter } from './model';
import { useDownloads } from './useDownloads';

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

const HANDLED_BY_BROWSER = 'That download was already handled by your browser.';
const NOTE_MS = 5000;

export const App = () => {
  const { downloads, actions } = useDownloads();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [pasted, setPasted] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [info, setInfo] = useState<AppInfo>({ saveDir: '', freeBytes: null });
  // The capture the browser extension is waiting on. The line in main decides which one comes next.
  const [capture, setCapture] = useState<CaptureView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const shownCapture = useRef<CaptureView | null>(null);
  const answeredCaptures = useRef(new Set<string>());
  const pasteRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);

  const refreshInfo = useCallback((): void => {
    void window.downloads.info().then(setInfo).catch(() => undefined);
  }, []);

  const finished = downloads.filter((d) => d.status === 'done').length;
  useEffect(refreshInfo, [finished, refreshInfo]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return downloads.filter(
      (d) => matchesFilter(d, filter) && (needle === '' || `${d.filename} ${d.url}`.toLowerCase().includes(needle)),
    );
  }, [downloads, filter, query]);

  const selected = downloads.find((d) => d.id === selectedId) ?? visible[0] ?? null;
  const failedCount = downloads.filter((d) => d.status === 'error').length;

  const toggle = useCallback((id: string) => {
    const d = downloads.find((x) => x.id === id);
    if (!d) return;
    if (isActive(d)) void actions.pause(id);
    else if (d.status === 'paused' || d.status === 'error') void actions.resume(id);
  }, [downloads, actions]);

  const remove = useCallback((id: string) => {
    const d = downloads.find((x) => x.id === id);
    if (!d) return;
    void (d.status === 'done' || d.status === 'error' ? actions.remove(id) : actions.cancel(id));
  }, [downloads, actions]);

  const copyLink = (id: string): void => {
    const d = downloads.find((x) => x.id === id);
    if (d) void navigator.clipboard?.writeText(d.url);
  };

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const showCapture = useCallback((next: CaptureView | null): void => {
    shownCapture.current = next;
    setCapture(next);
  }, []);

  useEffect(() => {
    // Subscribe first so nothing is missed, then ask for what was already waiting.
    const unsubscribe = window.captures.onIncoming((next) => {
      const shown = shownCapture.current;
      const gone = shown !== null && next?.captureId !== shown.captureId;
      // A capture that vanishes while the user has not answered it was settled elsewhere (the browser gave up).
      if (gone && !answeredCaptures.current.has(shown.captureId)) setNote(HANDLED_BY_BROWSER);
      showCapture(next);
    });
    window.captures
      .current()
      .then((waiting) => { if (shownCapture.current === null) showCapture(waiting); })
      .catch(() => undefined);
    return unsubscribe;
  }, [showCapture]);

  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const closeCapture = (captureId: string): void => {
    // The line may already have moved on to the next capture; only clear the one the user just answered.
    if (shownCapture.current?.captureId === captureId) showCapture(null);
  };

  const startAdd = (): void => {
    const url = pasted.trim();
    if (url === '') pasteRef.current?.focus();
    else setAdding(url);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (adding !== null || settingsOpen || capture !== null) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); queryRef.current?.focus(); return; }
      if (ctrl && e.key.toLowerCase() === 'v' && !isTyping(e.target)) { pasteRef.current?.focus(); return; }
      if (isTyping(e.target) || !selected) return;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (selected.status !== 'queued') return;
        e.preventDefault();
        void (e.key === 'ArrowUp' ? actions.moveUp(selected.id) : actions.moveDown(selected.id));
      } else if (e.key === ' ') { e.preventDefault(); toggle(selected.id); }
      else if (e.key === 'Delete' && e.shiftKey) void actions.removeAndDelete(selected.id);
      else if (e.key === 'Delete') remove(selected.id);
      else if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); void actions.showInFolder(selected.id); }
      else if (ctrl && e.key.toLowerCase() === 'c' && window.getSelection()?.toString() === '') copyLink(selected.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const menuTarget = menu ? downloads.find((d) => d.id === menu.id) : undefined;
  const menuPosition = menuTarget ? queuePosition(downloads, menuTarget.id) : 0;
  const title = FILTERS.find((f) => f.id === filter)?.label ?? 'All downloads';

  return (
    <div className="shell">
      <Sidebar filter={filter} failedCount={failedCount} onFilter={setFilter} onOpenSettings={() => setSettingsOpen(true)} />
      <div className="shell__main">
        <TopBar value={pasted} saveDir={info.saveDir} inputRef={pasteRef} onChange={setPasted} onSubmit={startAdd} />
        <div className="content">
          <Toolbar
            title={title}
            count={visible.length}
            canResume={!!selected && (selected.status === 'paused' || selected.status === 'error')}
            canPause={!!selected && isActive(selected)}
            canRemove={!!selected}
            hasSelection={!!selected}
            query={query}
            queryRef={queryRef}
            anyActive={downloads.some(isActive)}
            onResume={() => selected && toggle(selected.id)}
            onPause={() => selected && toggle(selected.id)}
            onRemove={() => selected && remove(selected.id)}
            onShowInFolder={() => selected && void actions.showInFolder(selected.id)}
            onQuery={setQuery}
            onPauseAll={() => downloads.filter(isActive).forEach((d) => void actions.pause(d.id))}
          />
          <section className="content__list">
            <DownloadList
              downloads={visible}
              all={downloads}
              selectedId={selected?.id ?? null}
              filtered={filter !== 'all' || query !== ''}
              onSelect={setSelectedId}
              onPause={(id) => void actions.pause(id)}
              onResume={(id) => void actions.resume(id)}
              onOpen={(id) => void actions.openFile(id)}
              onMenu={(id, anchor) => setMenu({ id, anchor })}
            />
          </section>
          <DetailsPanel download={selected} />
        </div>
        <StatusBar downloads={downloads} freeBytes={info.freeBytes} />
      </div>

      {menu && menuTarget && (
        <RowMenu
          download={menuTarget}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onToggle={() => toggle(menuTarget.id)}
          onCopyLink={() => copyLink(menuTarget.id)}
          onShowInFolder={() => void actions.showInFolder(menuTarget.id)}
          onProperties={() => setSelectedId(menuTarget.id)}
          onRemove={() => remove(menuTarget.id)}
          onRemoveAndDelete={() => void actions.removeAndDelete(menuTarget.id)}
          canMoveUp={menuPosition > 1}
          canMoveDown={menuPosition < queuedCount(downloads)}
          onMoveUp={() => void actions.moveUp(menuTarget.id)}
          onMoveDown={() => void actions.moveDown(menuTarget.id)}
          onStartNow={() => void actions.startNow(menuTarget.id)}
        />
      )}
      {capture !== null && (
        <AddDownloadDialog
          key={capture.captureId}
          url={capture.url}
          capture={capture}
          onAdd={async () => undefined}
          onAct={(captureId) => answeredCaptures.current.add(captureId)}
          onClose={() => closeCapture(capture.captureId)}
        />
      )}
      {note !== null && <p className="notice" role="status">{note}</p>}
      {capture === null && settingsOpen && <SettingsDialog onClose={closeSettings} onSaveDirChanged={refreshInfo} />}
      {capture === null && adding !== null && (
        <AddDownloadDialog
          url={adding}
          onAdd={async (url) => { await actions.add(url); setPasted(''); }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
};

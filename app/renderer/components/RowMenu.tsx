import { useEffect, useRef, type ReactNode } from 'react';
import type { DownloadView } from '../../shared/api';
import { IconChevron, IconClose, IconFolder, IconLink, IconMore, IconPause, IconPlay, IconTrash } from './Icons';

type RowMenuProps = {
  download: DownloadView;
  anchor: DOMRect;
  onClose: () => void;
  onToggle: () => void;
  onCopyLink: () => void;
  onShowInFolder: () => void;
  onProperties: () => void;
  onRemove: () => void;
  onRemoveAndDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onStartNow: () => void;
};

const Item = ({ icon, label, hint, danger, disabled, onClick }: {
  icon: ReactNode; label: string; hint?: string; danger?: boolean; disabled?: boolean; onClick: () => void;
}) => (
  <button
    role="menuitem"
    className={`menu__item ${danger ? 'menu__item--danger' : ''}`}
    disabled={disabled}
    onClick={disabled ? undefined : onClick}
  >
    {icon}
    <span>{label}</span>
    {hint && <kbd>{hint}</kbd>}
  </button>
);

export const RowMenu = (p: RowMenuProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const { download: d } = p;

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      p.onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [p]);

  const running = d.status === 'downloading' || d.status === 'waiting';
  const canToggle = running || d.status === 'paused' || d.status === 'error';
  // Open to the left of the button, below it; keep inside the window.
  const left = Math.max(8, Math.min(p.anchor.right - 264, window.innerWidth - 272));
  const top = Math.min(p.anchor.bottom + 4, window.innerHeight - 340);
  const queued = d.status === 'queued';
  const canStartNow = queued || d.status === 'paused' || d.status === 'error';
  const run = (fn: () => void) => () => { fn(); p.onClose(); };

  return (
    <div className="menu" role="menu" ref={ref} style={{ left, top }}>
      {canToggle && (
        <Item
          icon={running ? <IconPause /> : <IconPlay />}
          label={running ? 'Pause' : d.status === 'error' ? 'Retry' : 'Resume'}
          hint="Space"
          onClick={run(p.onToggle)}
        />
      )}
      {canStartNow && <Item icon={<IconPlay />} label="Start now" onClick={run(p.onStartNow)} />}
      {queued && (
        <>
          <Item
            icon={<IconChevron className="menu__icon--up" />}
            label="Move up"
            hint="Alt+Up"
            disabled={!p.canMoveUp}
            onClick={run(p.onMoveUp)}
          />
          <Item icon={<IconChevron />} label="Move down" hint="Alt+Down" disabled={!p.canMoveDown} onClick={run(p.onMoveDown)} />
        </>
      )}
      <Item icon={<IconLink />} label="Copy link" hint="Ctrl+C" onClick={run(p.onCopyLink)} />
      <Item icon={<IconFolder />} label="Show in folder" hint="Ctrl+E" onClick={run(p.onShowInFolder)} />
      <div className="menu__rule" />
      <Item icon={<IconMore />} label="Properties" onClick={run(p.onProperties)} />
      <div className="menu__rule" />
      <Item icon={<IconClose />} label="Remove from list" hint="Del" onClick={run(p.onRemove)} />
      <Item icon={<IconTrash />} label="Remove and delete file" hint="Shift+Del" danger onClick={run(p.onRemoveAndDelete)} />
    </div>
  );
};

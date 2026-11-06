import { IconFolder, IconPause, IconPlay, IconSearch, IconTrash } from './Icons';

type ToolbarProps = {
  title: string;
  count: number;
  canResume: boolean;
  canPause: boolean;
  canRemove: boolean;
  hasSelection: boolean;
  query: string;
  queryRef: React.RefObject<HTMLInputElement | null>;
  anyActive: boolean;
  onResume: () => void;
  onPause: () => void;
  onRemove: () => void;
  onShowInFolder: () => void;
  onQuery: (query: string) => void;
  onPauseAll: () => void;
};

export const Toolbar = (p: ToolbarProps) => (
  <div className="toolbar">
    <h1 className="toolbar__title">{p.title}</h1>
    <span className="toolbar__count">{p.count} {p.count === 1 ? 'file' : 'files'}</span>
    <span className="toolbar__rule" />
    <button className="btn btn--text" disabled={!p.canResume} onClick={p.onResume}><IconPlay />Resume</button>
    <button className="btn btn--text" disabled={!p.canPause} onClick={p.onPause}><IconPause />Pause</button>
    <button className="btn btn--text" disabled={!p.canRemove} onClick={p.onRemove}><IconTrash />Remove</button>
    <button className="btn btn--text" disabled={!p.hasSelection} onClick={p.onShowInFolder}><IconFolder />Show in folder</button>
    <div className="toolbar__spacer" />
    <label className="filter">
      <IconSearch />
      <input
        ref={p.queryRef}
        value={p.query}
        placeholder="Filter by name"
        aria-label="Filter by name"
        onChange={(e) => p.onQuery(e.target.value)}
      />
      <span className="paste__hint">Ctrl+F</span>
    </label>
    <button className="btn btn--outline" disabled={!p.anyActive} onClick={p.onPauseAll}><IconPause />Pause all</button>
  </div>
);

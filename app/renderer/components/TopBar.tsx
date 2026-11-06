import { useRef } from 'react';
import { IconLink, IconDown, IconFolder, IconWinClose, IconWinMax, IconWinMin } from './Icons';

type TopBarProps = {
  value: string;
  saveDir: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export const TopBar = ({ value, saveDir, inputRef, onChange, onSubmit }: TopBarProps) => {
  const fallback = useRef<HTMLInputElement>(null);
  return (
    <header className="topbar">
      <form
        className="topbar__add"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <label className="paste">
          <IconLink />
          <input
            ref={inputRef ?? fallback}
            value={value}
            placeholder="Paste a link to download"
            aria-label="Link"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="paste__hint">Ctrl+V</span>
        </label>
        <button type="submit" className="btn btn--primary">
          <IconDown />
          Download
        </button>
      </form>
      <div className="topbar__spacer" />
      <p className="topbar__save" title={saveDir}>
        <IconFolder />
        <span>Save to <strong>{saveDir || '…'}</strong></span>
      </p>
      <div className="winctl">
        <button aria-label="Minimize" onClick={() => void window.appWindow.minimize()}><IconWinMin /></button>
        <button aria-label="Maximize" onClick={() => void window.appWindow.toggleMaximize()}><IconWinMax /></button>
        <button aria-label="Close" className="winctl__close" onClick={() => void window.appWindow.close()}><IconWinClose /></button>
      </div>
    </header>
  );
};

import { useEffect, useState } from 'react';
import type { LinkPreview } from '../../shared/api';
import { formatBytes } from '../format';
import { IconClose, IconLink } from './Icons';

type AddDownloadDialogProps = {
  url: string;
  onAdd: (url: string) => void | Promise<void>;
  onClose: () => void;
};

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; preview: LinkPreview }
  | { phase: 'failed'; message: string };

const MIB = 1024 * 1024;

export const AddDownloadDialog = ({ url, onAdd, onClose }: AddDownloadDialogProps) => {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.downloads
      .preview(url)
      .then((preview) => !cancelled && setState({ phase: 'ready', preview }))
      .catch((err: unknown) => {
        if (!cancelled) setState({ phase: 'failed', message: err instanceof Error ? err.message : 'Could not read that link' });
      });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = async (): Promise<void> => {
    try {
      await onAdd(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that link');
    }
  };

  const preview = state.phase === 'ready' ? state.preview : null;

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="Add download">
        <div className="dialog__head">
          <h2>Add download</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>
        <div className="dialog__url"><IconLink /><span title={url}>{url}</span></div>

        <div className="dialog__card">
          {state.phase === 'loading' && <p className="dialog__status">Checking the link…</p>}
          {state.phase === 'failed' && <p className="dialog__status dialog__status--error" role="alert">{state.message}</p>}
          {preview && (
            <>
              <h3>{preview.filename}</h3>
              <dl>
                <dt>Size</dt>
                <dd>{preview.size === null ? 'Unknown' : formatBytes(preview.size)}</dd>
                <dt>Resumable</dt>
                <dd>
                  {preview.rangeSupported ? 'Yes, the server answered 206' : 'No, the server ignores byte ranges'}
                  <small>{preview.rangeSupported ? 'Pause any time and pick up where it stopped' : 'Pausing will start the file over'}</small>
                </dd>
                <dt>Connections</dt>
                <dd>
                  {preview.connections}
                  {preview.size !== null && preview.connections > 1 && (
                    <small>{formatBytes(Math.ceil(preview.size / preview.connections)).replace(/\.0 /, ' ')} per range</small>
                  )}
                  {preview.size !== null && preview.connections === 1 && preview.size < MIB && <small>Small file, one connection is enough</small>}
                </dd>
                <dt>From</dt>
                <dd>{preview.host}</dd>
                <dt>Save to</dt>
                <dd className="dialog__path">{preview.saveTo}</dd>
              </dl>
            </>
          )}
        </div>

        {error && <p className="dialog__status dialog__status--error" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button className="btn btn--text" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={!preview} onClick={() => void add()}>Add to queue</button>
        </div>
      </div>
    </div>
  );
};

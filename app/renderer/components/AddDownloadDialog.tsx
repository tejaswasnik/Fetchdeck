import { useEffect, useRef, useState } from 'react';
import type { CaptureView, LinkPreview } from '../../shared/api';
import { formatBytes } from '../format';
import { IconClose, IconLink } from './Icons';
import { Pill } from './Pill';

type AddDownloadDialogProps = {
  url: string;
  /** Set when the browser extension handed this link over: the dialog then answers the extension instead of adding. */
  capture?: CaptureView;
  onAdd: (url: string) => void | Promise<void>;
  onClose: () => void;
  /** Called the moment the user answers a capture, before the answer is sent. */
  onAct?: (captureId: string) => void;
};

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; preview: LinkPreview }
  | { phase: 'failed'; message: string };

const MIB = 1024 * 1024;

export const AddDownloadDialog = ({ url, capture, onAdd, onClose, onAct }: AddDownloadDialogProps) => {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const answered = useRef(false);
  const captureId = capture?.captureId;

  useEffect(() => {
    let cancelled = false;
    // A capture carries cookies the page must never hold, so main probes it by id.
    (captureId === undefined ? window.downloads.preview(url) : window.captures.preview(captureId))
      .then((preview) => !cancelled && setState({ phase: 'ready', preview }))
      .catch((err: unknown) => {
        if (!cancelled) setState({ phase: 'failed', message: err instanceof Error ? err.message : 'Could not read that link' });
      });
    return () => { cancelled = true; };
  }, [url, captureId]);

  // Leaving a capture unanswered would leave the browser's download paused, so every way out hands it back.
  const dismiss = (): void => {
    if (captureId === undefined) return onClose();
    if (answered.current) return;
    answered.current = true;
    onAct?.(captureId);
    void window.captures.dismiss(captureId).catch(() => undefined).finally(onClose);
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismissRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const add = async (): Promise<void> => {
    if (captureId !== undefined) {
      if (answered.current) return;
      answered.current = true;
      onAct?.(captureId);
    }
    try {
      if (captureId === undefined) await onAdd(url);
      else await window.captures.accept(captureId);
      onClose();
    } catch (err) {
      answered.current = false; // the capture is still waiting, so the user can try again or hand it back
      setError(err instanceof Error ? err.message : 'Could not add that link');
    }
  };

  const preview = state.phase === 'ready' ? state.preview : null;

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className="dialog" role="dialog" aria-label="Add download">
        <div className="dialog__head">
          <h2>Add download</h2>
          <button className="iconbtn" aria-label="Close" onClick={dismiss}><IconClose /></button>
        </div>
        {capture && capture.waiting > 0 && <p className="dialog__waiting">{capture.waiting} more waiting</p>}
        <div className="dialog__url">
          <IconLink /><span title={url}>{url}</span>
          {capture && <Pill tone="neutral">From browser</Pill>}
        </div>

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
          {capture ? (
            <>
              <button className="btn btn--text" onClick={dismiss}>Download in browser</button>
              <button className="btn btn--primary" disabled={!preview} onClick={() => void add()}>Download</button>
            </>
          ) : (
            <>
              <button className="btn btn--text" onClick={onClose}>Cancel</button>
              <button className="btn btn--primary" disabled={!preview} onClick={() => void add()}>Add to queue</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

import type { DownloadView } from '../../shared/api';
import { formatBytes, formatEta } from '../format';

type DownloadRowProps = {
  download: DownloadView;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
};

const percentOf = (d: DownloadView): number | null => {
  if (d.status === 'done') return 100;
  if (d.size === null || d.size === 0) return null;
  return Math.min(100, Math.floor((d.bytesDone / d.size) * 100));
};

const STATUS_LABEL: Record<DownloadView['status'], string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  waiting: 'Waiting for the network…',
  paused: 'Paused',
  done: 'Done',
  error: 'Failed',
};

export const DownloadRow = ({ download, onPause, onResume, onCancel, onRemove }: DownloadRowProps) => {
  const { id, status } = download;
  const percent = percentOf(download);
  const active = status === 'downloading' || status === 'waiting';
  const sizeText =
    download.size === null
      ? formatBytes(download.bytesDone)
      : `${formatBytes(download.bytesDone)} of ${formatBytes(download.size)}`;

  return (
    <li className={`row row--${status}`}>
      <div className="row__main">
        <p className="row__name" title={download.finalUrl}>
          {download.filename || download.url}
        </p>
        <div
          className="bar"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div className="bar__fill" style={{ width: `${percent ?? (active ? 8 : 0)}%` }} />
        </div>
        <p className="row__meta">
          <span>{STATUS_LABEL[status]}</span>
          <span>{sizeText}</span>
          {status === 'downloading' && <span>{formatBytes(download.speed)}/s</span>}
          {status === 'downloading' && <span>ETA {formatEta(download.etaSeconds)}</span>}
        </p>
        {status === 'error' && download.error && <p className="row__error">{download.error}</p>}
        {status === 'paused' && download.error && <p className="row__error">{download.error}</p>}
        {!download.rangeSupported && status !== 'done' && (
          <p className="row__note">Can&apos;t resume: the server doesn&apos;t support it</p>
        )}
      </div>
      <div className="row__actions">
        {active && <button onClick={() => onPause(id)}>Pause</button>}
        {status === 'paused' && <button onClick={() => onResume(id)}>Resume</button>}
        {status === 'error' && <button onClick={() => onResume(id)}>Retry</button>}
        {(status === 'done' || status === 'error') && <button onClick={() => onRemove(id)}>Remove</button>}
        {status !== 'done' && status !== 'error' && <button onClick={() => onCancel(id)}>Cancel</button>}
      </div>
    </li>
  );
};

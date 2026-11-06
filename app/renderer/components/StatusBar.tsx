import { formatBytes, splitSpeed } from '../format';
import type { DownloadView } from '../../shared/api';

export const StatusBar = ({ downloads, freeBytes }: { downloads: DownloadView[]; freeBytes: number | null }) => {
  const downloading = downloads.filter((d) => d.status === 'downloading');
  const waiting = downloads.filter((d) => d.status === 'waiting').length;
  const queued = downloads.filter((d) => d.status === 'queued').length;
  const total = downloading.reduce((sum, d) => sum + d.speed, 0);
  const speed = splitSpeed(total);
  return (
    <footer className="statusbar">
      <span className="statusbar__live">
        <i className={`dot ${downloading.length > 0 ? 'dot--live' : ''}`} />
        {downloading.length} downloading{downloading.length > 0 ? ` · ${speed.value} ${speed.unit}` : ''}
      </span>
      {waiting > 0 && <span className="muted">{waiting} waiting to reconnect</span>}
      {queued > 0 && <span className="muted">{queued} in line</span>}
      <span className="statusbar__spacer" />
      {freeBytes !== null && <span className="muted">{formatBytes(freeBytes)} free</span>}
    </footer>
  );
};

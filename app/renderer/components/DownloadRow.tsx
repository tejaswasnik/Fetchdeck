import type { DownloadView } from '../../shared/api';
import { formatBytes, formatEta, formatProgress, hostOf, ordinal, splitSpeed } from '../format';
import { isActive, percentOf } from '../model';
import { IconMore } from './Icons';
import { Pill } from './Pill';
import { SegmentBar } from './SegmentBar';

type DownloadRowProps = {
  download: DownloadView;
  position?: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onOpen?: (id: string) => void;
  onMenu?: (id: string, anchor: DOMRect) => void;
};

const DASH = <span className="dash">—</span>;

const SubLine = ({ download, position }: { download: DownloadView; position: number }) => {
  const host = hostOf(download.finalUrl || download.url);
  const { status } = download;
  if (status === 'waiting') {
    return (<><Pill tone="warning">Reconnecting…</Pill><span>{host}</span></>);
  }
  if (status === 'error') {
    return (<><Pill tone="negative">{download.error ?? 'Failed'}</Pill><span>{host}</span></>);
  }
  if (status === 'queued') {
    return (<><Pill tone="neutral">{position === 1 ? 'Next in line' : `${ordinal(position)} in line`}</Pill><span>{host}</span></>);
  }
  if (status === 'paused') {
    if (!download.rangeSupported) return <span>Can&apos;t resume: the server doesn&apos;t support it</span>;
    return <span>{download.error ? `${download.error} · ${host}` : `Paused · ${host}`}</span>;
  }
  if (status === 'done') return <span>{`Done · ${host}`}</span>;
  const connections = download.segments.length;
  return <span>{connections > 1 ? `${host} · ${connections} connections` : host}</span>;
};

export const DownloadRow = ({
  download, position = 0, selected = false, onSelect, onPause, onResume, onOpen, onMenu,
}: DownloadRowProps) => {
  const { id, status } = download;
  const percent = percentOf(download);
  const active = isActive(download);
  const showProgress = status === 'downloading' || status === 'waiting' || status === 'paused';
  const speed = status === 'downloading' ? splitSpeed(download.speed) : null;
  const sizeText =
    download.size === null ? formatBytes(download.bytesDone) : formatProgress(download.bytesDone, download.size);
  const restart = status === 'paused' && !download.rangeSupported;

  return (
    <li
      className={`row row--${status} ${selected ? 'row--selected' : ''}`}
      aria-selected={selected}
      onClick={() => onSelect?.(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect?.(id);
        onMenu?.(id, new DOMRect(e.clientX, e.clientY, 0, 0));
      }}
    >
      <div className="row__file">
        <p className="row__name" title={download.finalUrl}>{download.filename || download.url}</p>
        <p className="row__sub"><SubLine download={download} position={position} /></p>
      </div>

      <div className="row__progress">
        {showProgress ? (
          <>
            <SegmentBar segments={download.segments} percent={percent} live={status === 'downloading'} />
            <p className="row__size">{restart ? `${formatBytes(download.bytesDone)} · starts over` : sizeText}</p>
          </>
        ) : status === 'done' && download.size !== null ? (
          <p className="row__size row__size--done">{formatBytes(download.size)}</p>
        ) : (
          DASH
        )}
      </div>

      <div className="row__speed">
        {speed ? (<><span>{speed.value}</span> <span className="unit">{speed.unit}</span></>) : DASH}
      </div>
      <div className="row__eta">{status === 'downloading' ? formatEta(download.etaSeconds) : DASH}</div>

      <div className="row__action">
        {active && <button className="btn btn--outline btn--small" onClick={(e) => { e.stopPropagation(); onPause(id); }}>Pause</button>}
        {status === 'paused' && (
          <button className="btn btn--outline btn--small" onClick={(e) => { e.stopPropagation(); onResume(id); }}>
            {restart ? 'Restart' : 'Resume'}
          </button>
        )}
        {status === 'error' && <button className="btn btn--outline btn--small" onClick={(e) => { e.stopPropagation(); onResume(id); }}>Retry</button>}
        {status === 'done' && <button className="btn btn--outline btn--small" onClick={(e) => { e.stopPropagation(); onOpen?.(id); }}>Open</button>}
      </div>

      <button
        className="iconbtn"
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(id);
          onMenu?.(id, e.currentTarget.getBoundingClientRect());
        }}
      >
        <IconMore />
      </button>
    </li>
  );
};

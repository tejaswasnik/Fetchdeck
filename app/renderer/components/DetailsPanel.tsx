import type { DownloadView } from '../../shared/api';
import { formatBytes, formatClock, formatEta, formatOffset, formatProgress, hostOf, sizeUnit, splitSpeed } from '../format';
import { percentOf } from '../model';
import { IconCopy } from './Icons';
import { SegmentBar } from './SegmentBar';

const HEADLINE: Record<DownloadView['status'], string> = {
  queued: 'In line',
  downloading: '',
  waiting: 'Reconnecting…',
  paused: 'Paused',
  done: 'Finished',
  error: 'Failed',
};

const Headline = ({ d }: { d: DownloadView }) => {
  if (d.status === 'downloading' && d.etaSeconds !== null) {
    return <p className="panel__eta">{formatEta(d.etaSeconds)}<span> left</span></p>;
  }
  return <p className="panel__eta panel__eta--text">{HEADLINE[d.status] || 'Downloading'}</p>;
};

export const DetailsPanel = ({ download: d }: { download: DownloadView | null }) => {
  if (!d) return <aside className="panel panel--empty"><p>Select a download to see its details.</p></aside>;

  const percent = percentOf(d);
  const speed = d.status === 'downloading' ? splitSpeed(d.speed) : null;
  const size = d.size;
  const unit = size ? sizeUnit(size) : '';
  const copy = (text: string): void => void navigator.clipboard?.writeText(text);
  const summary = [
    size === null ? formatBytes(d.bytesDone) : formatProgress(d.bytesDone, size).replace(' / ', ' of '),
    percent === null ? null : `${percent}%`,
    speed ? `${speed.value} ${speed.unit}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <aside className="panel" aria-label="Download details">
      <h2 className="panel__name" title={d.filename}>{d.filename || d.url}</h2>
      <p className="panel__sub">{hostOf(d.finalUrl || d.url)} · added {formatClock(d.createdAt)}</p>

      <Headline d={d} />
      <p className="panel__summary">{summary}</p>

      <div className="panel__head">
        <h3>Byte ranges</h3>
        <span>
          {d.segments.length} {d.segments.length === 1 ? 'range' : 'ranges'}
        </span>
      </div>
      <SegmentBar segments={d.segments} percent={percent} live={d.status === 'downloading'} tall label="Byte ranges" />
      <ol className="panel__nums" aria-hidden="true">
        {d.segments.map((s, i) => (
          <li key={s.start} style={{ flexGrow: s.end - s.start + 1 }}>{i + 1}</li>
        ))}
      </ol>

      {d.segments.length > 0 && size !== null && (
        <>
          <div className="panel__head">
            <h3>Connections</h3>
            {speed && <span>{speed.value} {speed.unit} in all</span>}
          </div>
          <table className="conns">
            <tbody>
              {d.segments.map((s, i) => {
                const length = s.end - s.start + 1;
                const pct = Math.min(100, Math.round((s.downloaded / length) * 100));
                return (
                  <tr key={s.start}>
                    <td>{i + 1}</td>
                    <td className="conns__range">{formatOffset(s.start, size)}–{formatOffset(s.end + 1, size)} {unit}</td>
                    <td className="right">{pct}%</td>
                    <td className="right conns__state">{pct >= 100 ? 'Done' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div className="panel__head"><h3>Details</h3></div>
      <dl className="details">
        <dt>Link</dt>
        <dd>
          <span className="details__text" title={d.url}>{d.url.replace(/^https?:\/\//, '')}</span>
          <button className="iconbtn" aria-label="Copy link" onClick={() => copy(d.url)}><IconCopy /></button>
        </dd>
        <dt>Resumable</dt>
        <dd>
          <span className="details__text">
            {d.rangeSupported ? 'Yes, the server answered 206' : 'No, the server ignores byte ranges'}
          </span>
        </dd>
        <dt>ETag</dt>
        <dd>
          <span className="details__text">{d.etag ?? '—'}</span>
          {d.etag && <button className="iconbtn" aria-label="Copy ETag" onClick={() => copy(d.etag as string)}><IconCopy /></button>}
        </dd>
      </dl>
    </aside>
  );
};

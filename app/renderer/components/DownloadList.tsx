import type { DownloadView } from '../../shared/api';
import { queuePosition } from '../model';
import { DownloadRow } from './DownloadRow';

type DownloadListProps = {
  downloads: DownloadView[];
  all: DownloadView[];
  selectedId: string | null;
  filtered: boolean;
  onSelect: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (id: string, anchor: DOMRect) => void;
};

export const DownloadList = ({ downloads, all, selectedId, filtered, ...handlers }: DownloadListProps) => {
  if (downloads.length === 0) {
    return (
      <p className="empty">
        {filtered ? 'Nothing matches this view.' : 'No downloads yet. Paste a link above to get started.'}
      </p>
    );
  }
  return (
    <div className="table">
      <div className="table__head" aria-hidden="true">
        <span>File</span>
        <span>Progress</span>
        <span className="right">Speed</span>
        <span className="right">Time left</span>
        <span />
        <span />
      </div>
      <ul className="list">
        {downloads.map((download) => (
          <DownloadRow
            key={download.id}
            download={download}
            position={queuePosition(all, download.id)}
            selected={download.id === selectedId}
            {...handlers}
          />
        ))}
      </ul>
    </div>
  );
};

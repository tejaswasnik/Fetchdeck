import type { DownloadView } from '../../shared/api';
import { DownloadRow } from './DownloadRow';

type DownloadListProps = {
  downloads: DownloadView[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
};

export const DownloadList = ({ downloads, ...handlers }: DownloadListProps) => {
  if (downloads.length === 0) {
    return <p className="empty">No downloads yet. Add a link to get started.</p>;
  }
  return (
    <ul className="list">
      {downloads.map((download) => (
        <DownloadRow key={download.id} download={download} {...handlers} />
      ))}
    </ul>
  );
};

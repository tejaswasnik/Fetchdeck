import type { DownloadRecord } from '@fetchdeck/engine';

export type NotifierDeps = {
  enabled: () => boolean;
  isSupported: () => boolean;
  isWindowFocused: () => boolean;
  show: (notification: { title: string; body: string; onClick: () => void }) => void;
  showFile: (record: DownloadRecord) => void;
  revealWindow: () => void;
};

export const createNotifier = (deps: NotifierDeps): { onChanged(record: DownloadRecord): void } => {
  const lastStatus = new Map<string, DownloadRecord['status']>();

  const canNotify = (): boolean => deps.enabled() && deps.isSupported() && !deps.isWindowFocused();

  const onChanged = (record: DownloadRecord): void => {
    const previous = lastStatus.get(record.id);
    lastStatus.set(record.id, record.status);
    if (previous === undefined || previous === record.status) return;
    if (!canNotify()) return;

    if (record.status === 'done') {
      deps.show({
        title: 'Download complete',
        body: record.filename,
        onClick: () => deps.showFile(record),
      });
    } else if (record.status === 'error') {
      const message = record.error ?? 'unknown error';
      deps.show({
        title: 'Download failed',
        body: record.filename ? `${record.filename}: ${message}` : message,
        onClick: () => deps.revealWindow(),
      });
    }
  };

  return { onChanged };
};

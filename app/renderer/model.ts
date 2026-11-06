import type { DownloadView } from '../shared/api';

export type Filter = 'all' | 'downloading' | 'queued' | 'paused' | 'finished' | 'failed';

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All downloads' },
  { id: 'downloading', label: 'Downloading' },
  { id: 'queued', label: 'In line' },
  { id: 'paused', label: 'Paused' },
  { id: 'finished', label: 'Finished' },
  { id: 'failed', label: 'Failed' },
];

export const matchesFilter = (d: DownloadView, filter: Filter): boolean => {
  switch (filter) {
    case 'all': return true;
    case 'downloading': return d.status === 'downloading' || d.status === 'waiting';
    case 'queued': return d.status === 'queued';
    case 'paused': return d.status === 'paused';
    case 'finished': return d.status === 'done';
    case 'failed': return d.status === 'error';
  }
};

export const isActive = (d: DownloadView): boolean => d.status === 'downloading' || d.status === 'waiting';

const queued = (all: DownloadView[]): DownloadView[] => all.filter((d) => d.status === 'queued');

/** 1-based place in line among queued downloads, by queue position. */
export const queuePosition = (all: DownloadView[], id: string): number =>
  queued(all).sort((a, b) => a.position - b.position).findIndex((d) => d.id === id) + 1;

export const queuedCount = (all: DownloadView[]): number => queued(all).length;

export const percentOf = (d: DownloadView): number | null => {
  if (d.status === 'done') return 100;
  if (d.size === null || d.size === 0) return null;
  return Math.min(100, Math.floor((d.bytesDone / d.size) * 100));
};

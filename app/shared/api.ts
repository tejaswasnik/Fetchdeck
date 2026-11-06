import type { DownloadRecord } from '@fetchdeck/engine';

export type DownloadView = DownloadRecord & { bytesDone: number; speed: number; etaSeconds: number | null };

export interface DownloadsApi {
  add(url: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<DownloadView[]>;
  onUpdate(callback: (changed: DownloadView[]) => void): () => void; // returns unsubscribe
}

export const CHANNELS = {
  add: 'downloads:add',
  pause: 'downloads:pause',
  resume: 'downloads:resume',
  cancel: 'downloads:cancel',
  remove: 'downloads:remove',
  list: 'downloads:list',
  update: 'downloads:update',
} as const;

declare global {
  interface Window {
    downloads: DownloadsApi;
  }
}

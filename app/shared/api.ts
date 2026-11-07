import type { DownloadRecord } from '@fetchdeck/engine';

export type DownloadView = DownloadRecord & { bytesDone: number; speed: number; etaSeconds: number | null; position: number };

/** What the Add download dialog shows before the link is queued. */
export type LinkPreview = {
  filename: string;
  size: number | null;
  rangeSupported: boolean;
  host: string;
  connections: number;
  saveTo: string;
};

/** What the page may know about a link the browser extension wants to hand over. Never the cookies. */
export type CaptureView = { captureId: string; url: string; filename: string | null; size: number | null; waiting: number };

export type Settings = { saveDir: string; maxConcurrent: number; maxSegments: number; notifications: boolean; extensionEnabled: boolean };
export type SettingsPatch = Partial<Pick<Settings, 'maxConcurrent' | 'maxSegments' | 'notifications'>>;
export const SETTINGS_LIMITS = { maxConcurrent: { min: 1, max: 6 }, maxSegments: { min: 1, max: 8 } } as const;

export type AppInfo = { saveDir: string; freeBytes: number | null };

export interface DownloadsApi {
  add(url: string): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<DownloadView[]>;
  onUpdate(callback: (changed: DownloadView[]) => void): () => void; // returns unsubscribe
  preview(url: string): Promise<LinkPreview>;
  info(): Promise<AppInfo>;
  openFile(id: string): Promise<void>;
  showInFolder(id: string): Promise<void>;
  removeAndDelete(id: string): Promise<void>;
  moveUp(id: string): Promise<void>;
  moveDown(id: string): Promise<void>;
  startNow(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  /** Resolves to null when the folder dialog is cancelled. */
  chooseFolder(): Promise<Settings | null>;
}

export interface WindowApi {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
}

export const CHANNELS = {
  add: 'downloads:add',
  pause: 'downloads:pause',
  resume: 'downloads:resume',
  cancel: 'downloads:cancel',
  remove: 'downloads:remove',
  list: 'downloads:list',
  update: 'downloads:update',
  preview: 'downloads:preview',
  info: 'downloads:info',
  openFile: 'downloads:open-file',
  showInFolder: 'downloads:show-in-folder',
  removeAndDelete: 'downloads:remove-and-delete',
  moveUp: 'downloads:move-up',
  moveDown: 'downloads:move-down',
  startNow: 'downloads:start-now',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChooseFolder: 'settings:choose-folder',
  winMinimize: 'window:minimize',
  winToggleMaximize: 'window:toggle-maximize',
  winClose: 'window:close',
} as const;

declare global {
  interface Window {
    downloads: DownloadsApi;
    appWindow: WindowApi;
  }
}

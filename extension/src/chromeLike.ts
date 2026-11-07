import type { DownloadItemLike } from './shouldCapture';

// The part of `chrome` the controller uses, written as plain types so tests can pass a fake.
// The real `chrome` object satisfies it structurally; `background.ts` is the one place that hands it over.

type Listeners<Args extends unknown[]> = { addListener(callback: (...args: Args) => void): void };

export type StorageArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export type ClickInfo = { menuItemId: string | number; linkUrl?: string; srcUrl?: string; pageUrl?: string };

export type ChromeLike = {
  downloads: {
    pause(id: number): Promise<void>;
    resume(id: number): Promise<void>;
    cancel(id: number): Promise<void>;
    erase(query: { id: number }): Promise<number[]>;
    download(options: { url: string }): Promise<number>;
    onCreated: Listeners<[DownloadItemLike]>;
  };
  cookies: { getAll(details: { url: string }): Promise<{ name: string; value: string }[]> };
  contextMenus: {
    create(properties: { id: string; title: string; contexts: ['link'] }): void;
    removeAll(): Promise<void>;
    onClicked: Listeners<[ClickInfo]>;
  };
  storage: { local: StorageArea; session: StorageArea };
  action: { setBadgeText(details: { text: string }): Promise<void> };
  runtime: { onInstalled: Listeners<[]>; onStartup: Listeners<[]> };
};

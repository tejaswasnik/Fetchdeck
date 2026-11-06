import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type DownloadView, type DownloadsApi } from '../shared/api';

// Electron prefixes errors from invoke(); show only the original message.
const plainError = (err: unknown): Error => {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(message.replace(/^Error invoking remote method '[^']+': (?:\w+: )?/, ''));
};

const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args).catch((err: unknown) => {
    throw plainError(err);
  });

const api: DownloadsApi = {
  add: (url) => call(CHANNELS.add, url),
  pause: (id) => call(CHANNELS.pause, id),
  resume: (id) => call(CHANNELS.resume, id),
  cancel: (id) => call(CHANNELS.cancel, id),
  remove: (id) => call(CHANNELS.remove, id),
  list: () => call(CHANNELS.list),
  onUpdate: (callback) => {
    const listener = (_event: unknown, views: DownloadView[]): void => callback(views);
    ipcRenderer.on(CHANNELS.update, listener);
    return () => {
      ipcRenderer.removeListener(CHANNELS.update, listener);
    };
  },
};

contextBridge.exposeInMainWorld('downloads', api);

import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type CaptureView, type CapturesApi, type DownloadView, type DownloadsApi, type ExtensionApi, type WindowApi } from '../shared/api';

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
  preview: (url) => call(CHANNELS.preview, url),
  info: () => call(CHANNELS.info),
  openFile: (id) => call(CHANNELS.openFile, id),
  showInFolder: (id) => call(CHANNELS.showInFolder, id),
  removeAndDelete: (id) => call(CHANNELS.removeAndDelete, id),
  moveUp: (id) => call(CHANNELS.moveUp, id),
  moveDown: (id) => call(CHANNELS.moveDown, id),
  startNow: (id) => call(CHANNELS.startNow, id),
  getSettings: () => call(CHANNELS.settingsGet),
  updateSettings: (patch) => call(CHANNELS.settingsUpdate, patch),
  chooseFolder: () => call(CHANNELS.settingsChooseFolder),
  onUpdate: (callback) => {
    const listener = (_event: unknown, views: DownloadView[]): void => callback(views);
    ipcRenderer.on(CHANNELS.update, listener);
    return () => {
      ipcRenderer.removeListener(CHANNELS.update, listener);
    };
  },
};

const appWindow: WindowApi = {
  minimize: () => call(CHANNELS.winMinimize),
  toggleMaximize: () => call(CHANNELS.winToggleMaximize),
  close: () => call(CHANNELS.winClose),
};

const captures: CapturesApi = {
  current: () => call(CHANNELS.capturesCurrent),
  preview: (id) => call(CHANNELS.capturesPreview, id),
  accept: (id) => call(CHANNELS.capturesAccept, id),
  dismiss: (id) => call(CHANNELS.capturesDismiss, id),
  onIncoming: (callback) => {
    const listener = (_event: unknown, view: CaptureView | null): void => callback(view);
    ipcRenderer.on(CHANNELS.capturesIncoming, listener);
    return () => {
      ipcRenderer.removeListener(CHANNELS.capturesIncoming, listener);
    };
  },
};

const extension: ExtensionApi = {
  getStatus: () => call(CHANNELS.extensionStatus),
  setEnabled: (enabled) => call(CHANNELS.extensionSetEnabled, enabled),
  getToken: () => call(CHANNELS.extensionGetToken),
  regenerateToken: () => call(CHANNELS.extensionRegenerateToken),
};

contextBridge.exposeInMainWorld('downloads', api);
contextBridge.exposeInMainWorld('captures', captures);
contextBridge.exposeInMainWorld('extension', extension);
contextBridge.exposeInMainWorld('appWindow', appWindow);

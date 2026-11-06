import { DownloadQueue } from '@fetchdeck/queue';
import { BrowserWindow, app, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { CHANNELS } from '../shared/api';
import { registerIpc, setDefaultSaveDir } from './ipc';
import { createSystem } from './system';
import { createWindowOptions } from './windowOptions';

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow(createWindowOptions(join(import.meta.dirname, '../preload/index.cjs')));

  // Never let the page navigate away or open windows; links go to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  return win;
};

void app.whenReady().then(async () => {
  const queue = new DownloadQueue({ stateDir: join(app.getPath('userData'), 'downloads') });
  setDefaultSaveDir(app.getPath('downloads'));
  await queue.load();

  let window = createWindow();
  registerIpc(
    queue,
    (views) => {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.update, views);
    },
    ipcMain,
    undefined,
    createSystem(),
  );

  const windowOf = (sender: Electron.WebContents): BrowserWindow | null => BrowserWindow.fromWebContents(sender);
  ipcMain.handle(CHANNELS.winMinimize, (e) => windowOf(e.sender)?.minimize());
  ipcMain.handle(CHANNELS.winToggleMaximize, (e) => {
    const win = windowOf(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle(CHANNELS.winClose, (e) => windowOf(e.sender)?.close());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) window = createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

import { DownloadQueue } from '@fetchdeck/queue';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { CHANNELS } from '../shared/api';
import { registerIpc, setDefaultSaveDir } from './ipc';
import { createQuitGate, shouldCloseWindow } from './quitGuard';
import { revealWindow, shouldQuitAsDuplicate } from './singleInstance';
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

const hasLock = app.requestSingleInstanceLock();
if (shouldQuitAsDuplicate(hasLock)) app.quit();

void app.whenReady().then(async () => {
  if (!hasLock) return;
  const queue = new DownloadQueue({ stateDir: join(app.getPath('userData'), 'downloads') });
  setDefaultSaveDir(app.getPath('downloads'));
  await queue.load();

  const confirmQuit = async (): Promise<boolean> => {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Downloads are in progress. Quit and pause them?',
    });
    return response === 0;
  };

  let quitting = false;
  const attachCloseGuard = (win: BrowserWindow): void => {
    win.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      void shouldCloseWindow({ hasActiveDownloads: () => queue.hasActive(), confirmQuit }).then((ok) => {
        if (!ok) return;
        quitting = true;
        win.close();
      });
    });
  };

  let window = createWindow();
  attachCloseGuard(window);
  app.on('second-instance', () => revealWindow(window.isDestroyed() ? null : window));
  const ipc = registerIpc(
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
    if (BrowserWindow.getAllWindows().length === 0) {
      window = createWindow();
      attachCloseGuard(window);
    }
  });

  // Pause running downloads (file synced, record saved) before the process exits.
  const gate = createQuitGate();
  app.on('before-quit', (event) => {
    if (!gate.begin()) return;
    event.preventDefault();
    quitting = true;
    void (async () => {
      try {
        await queue.shutdown();
        ipc.dispose();
      } finally {
        app.quit();
      }
    })();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

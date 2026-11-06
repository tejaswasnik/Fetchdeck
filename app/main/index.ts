import { DownloadQueue } from '@fetchdeck/queue';
import { BrowserWindow, Notification, app, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { CHANNELS } from '../shared/api';
import { registerIpc } from './ipc';
import { createNotifier } from './notifier';
import { createSettingsStore } from './settings';
import { createQuitGate, shouldCloseWindow } from './quitGuard';
import { revealWindow, shouldQuitAsDuplicate } from './singleInstance';
import { attachSmokeTest, isSmokeRun } from './smoke';
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

// Windows groups and shows notifications under this id (the appId in electron-builder.yml).
app.setAppUserModelId('com.fetchdeck.app');

// A smoke run must not be turned away (or turn away a running copy) because of the lock.
const hasLock = isSmokeRun(process.argv) || app.requestSingleInstanceLock();
if (shouldQuitAsDuplicate(hasLock)) app.quit();

void app.whenReady().then(async () => {
  if (!hasLock) return;
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

  const settings = createSettingsStore({ path: join(app.getPath('userData'), 'settings.json'), defaultSaveDir: app.getPath('downloads') });
  await settings.load();
  const queue = new DownloadQueue({
    stateDir: join(app.getPath('userData'), 'downloads'),
    maxConcurrent: settings.get().maxConcurrent,
    maxSegments: settings.get().maxSegments,
  });
  const notifier = createNotifier({
    enabled: () => settings.get().notifications,
    isSupported: () => Notification.isSupported(),
    isWindowFocused: () => !window.isDestroyed() && window.isFocused() && window.isVisible() && !window.isMinimized(),
    show: ({ title, body, onClick }) => {
      const notification = new Notification({ title, body });
      notification.on('click', onClick);
      notification.show();
    },
    showFile: (record) => shell.showItemInFolder(join(record.saveDir, record.filename)),
    revealWindow: () => revealWindow(window.isDestroyed() ? null : window),
  });
  // Attach before load() so the notifier first sees restored records as their baseline status.
  queue.on('changed', notifier.onChanged);
  await queue.load();
  // CI launches the built app with --smoke to prove it starts; normal runs skip this.
  if (isSmokeRun(process.argv)) attachSmokeTest(window.webContents, (code) => {
      console.log(`smoke test ${code === 0 ? 'passed' : 'failed'}`);
      app.exit(code);
    });
  app.on('second-instance', () => revealWindow(window.isDestroyed() ? null : window));
  const ipc = registerIpc(
    queue,
    (views) => {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.update, views);
    },
    ipcMain,
    undefined,
    createSystem(),
    settings,
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

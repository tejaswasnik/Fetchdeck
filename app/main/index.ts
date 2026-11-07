import { DownloadQueue } from '@fetchdeck/queue';
import { BrowserWindow, Notification, app, dialog, ipcMain, safeStorage, screen, shell } from 'electron';
import { join } from 'node:path';
import { CHANNELS } from '../shared/api';
import { createSafeStorageAuthStore } from './authStore';
import { registerCaptureIpc } from './captureIpc';
import { createCaptureLine } from './captureLine';
import { createExtensionServer } from './extensionServer';
import { registerIpc } from './ipc';
import { createNotifier } from './notifier';
import { createPairingToken } from './pairingToken';
import { createSettingsStore } from './settings';
import { createQuitGate, shouldCloseWindow } from './quitGuard';
import { revealWindow, shouldQuitAsDuplicate } from './singleInstance';
import { attachSmokeTest, isSmokeRun } from './smoke';
import { createSystem } from './system';
import { createWindowOptions } from './windowOptions';

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow(
    createWindowOptions(join(import.meta.dirname, '../preload/index.cjs'), undefined, screen.getPrimaryDisplay().workAreaSize),
  );

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
// Unpackaged runs have no Start-menu shortcut carrying that id, so Windows would drop their toasts.
app.setAppUserModelId(app.isPackaged ? 'com.fetchdeck.app' : process.execPath);

// A smoke run must not be turned away (or turn away a running copy) because of the lock.
const hasLock = isSmokeRun(process.argv) || app.requestSingleInstanceLock();
if (shouldQuitAsDuplicate(hasLock)) app.quit();

void app.whenReady().then(async () => {
  if (!hasLock) return;
  // Everything the page or the notifier can reach is built before the window exists.
  let window: BrowserWindow | undefined;
  const liveWindow = (): BrowserWindow | null => (window && !window.isDestroyed() ? window : null);
  app.on('second-instance', () => revealWindow(liveWindow()));

  const settings = createSettingsStore({ path: join(app.getPath('userData'), 'settings.json'), defaultSaveDir: app.getPath('downloads') });
  await settings.load();
  const queue = new DownloadQueue({
    stateDir: join(app.getPath('userData'), 'downloads'),
    maxConcurrent: settings.get().maxConcurrent,
    maxSegments: settings.get().maxSegments,
    authStore: createSafeStorageAuthStore({ dir: join(app.getPath('userData'), 'auth'), safeStorage }),
  });
  const shownNotifications = new Set<Notification>();
  const notifier = createNotifier({
    enabled: () => settings.get().notifications,
    isSupported: () => Notification.isSupported(),
    isWindowFocused: () => {
      const win = liveWindow();
      return win !== null && win.isFocused() && win.isVisible() && !win.isMinimized();
    },
    show: ({ title, body, onClick }) => {
      const notification = new Notification({ title, body });
      // Electron drops a notification's listeners once it is garbage-collected, so hold it until it is gone.
      shownNotifications.add(notification);
      notification.on('click', () => {
        shownNotifications.delete(notification);
        onClick();
      });
      notification.on('close', () => shownNotifications.delete(notification));
      notification.show();
    },
    showFile: (record) => shell.showItemInFolder(join(record.saveDir, record.filename)),
    revealWindow: () => revealWindow(liveWindow()),
  });
  // Attach before load() so the notifier first sees restored records as their baseline status.
  queue.on('changed', notifier.onChanged);
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

  const system = createSystem();
  const ipc = registerIpc(
    queue,
    (views) => {
      liveWindow()?.webContents.send(CHANNELS.update, views);
    },
    ipcMain,
    undefined,
    system,
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

  // The browser extension: a local server that hands captured downloads to a dialog in this window.
  const line = createCaptureLine();
  const token = createPairingToken({ path: join(app.getPath('userData'), 'pairing.token'), safeStorage });
  const server = createExtensionServer({ version: app.getVersion(), getToken: () => token.get(), line });
  let shownCaptureId: string | null = null;
  const captureIpc = registerCaptureIpc({
    line,
    queue,
    settings,
    system,
    token,
    server,
    ipc: ipcMain,
    onIncoming: (view) => {
      const win = liveWindow();
      win?.webContents.send(CHANNELS.capturesIncoming, view);
      // Bring the dialog's window forward once per capture, not on every change to the line.
      if (win && view && view.captureId !== shownCaptureId) {
        if (!win.isFocused()) win.flashFrame(true);
        revealWindow(win);
      }
      shownCaptureId = view?.captureId ?? null;
    },
  });
  if (settings.get().extensionEnabled) await server.start();

  window = createWindow();
  attachCloseGuard(window);
  // CI launches the built app with --smoke to prove it starts; normal runs skip this.
  if (isSmokeRun(process.argv)) attachSmokeTest(window.webContents, (code) => {
      console.log(`smoke test ${code === 0 ? 'passed' : 'failed'}`);
      app.exit(code);
    });

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
        // Dismiss every pending capture first, so each browser download resumes instead of waiting on a closed app.
        await server.stop().catch(() => undefined);
        await queue.shutdown();
        ipc.dispose();
        captureIpc.dispose();
      } finally {
        app.quit();
      }
    })();
  });
}).catch((err: unknown) => {
  // Without this a failed start leaves a windowless process holding the single-instance lock.
  dialog.showErrorBox('Fetchdeck could not start', err instanceof Error ? err.message : String(err));
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

import type { BrowserWindowConstructorOptions } from 'electron';

// The page gets no Node access; it talks to the app only through the preload bridge.
// The title bar is drawn by the page (frameless), so the window controls go through IPC too.
export const createWindowOptions = (preloadPath: string, iconPath?: string): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 600,
  title: 'Fetchdeck',
  frame: false,
  backgroundColor: '#101513',
  ...(iconPath ? { icon: iconPath } : {}),
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});

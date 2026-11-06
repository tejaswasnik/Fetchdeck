import type { BrowserWindowConstructorOptions } from 'electron';

// The page gets no Node access; it talks to the app only through the preload bridge.
export const createWindowOptions = (preloadPath: string): BrowserWindowConstructorOptions => ({
  width: 960,
  height: 640,
  minWidth: 560,
  minHeight: 400,
  title: 'Fetchdeck',
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});

import type { BrowserWindowConstructorOptions } from 'electron';

// The page gets no Node access; it talks to the app only through the preload bridge.
// The title bar is drawn by the page (frameless), so the window controls go through IPC too.
export type WorkArea = { width: number; height: number };

// The window never opens larger than the screen's usable area (screen minus taskbar), so its bottom edge,
// and the Settings button at the bottom of the sidebar, cannot start off-screen on a small or scaled display.
const fitTo = (size: number, available: number | undefined): number =>
  available === undefined ? size : Math.min(size, Math.max(available, 1));

export const createWindowOptions = (
  preloadPath: string,
  iconPath?: string,
  workArea?: WorkArea,
): BrowserWindowConstructorOptions => ({
  width: fitTo(1280, workArea?.width),
  height: fitTo(800, workArea?.height),
  minWidth: fitTo(960, workArea?.width),
  minHeight: fitTo(600, workArea?.height),
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

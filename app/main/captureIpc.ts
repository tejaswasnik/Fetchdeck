import type { DownloadQueue } from '@fetchdeck/queue';
import { CHANNELS, type CaptureView, type ExtensionStatus } from '../shared/api';
import type { CaptureLine } from './captureLine';
import type { ExtensionServer } from './extensionServer';
import type { IpcMainLike, SystemLike } from './ipc';
import type { SettingsStore } from './settings';
import { asId } from './validate';

export type CaptureIpcDeps = {
  line: CaptureLine;
  queue: Pick<DownloadQueue, 'add'>;
  settings: Pick<SettingsStore, 'get' | 'setExtensionEnabled'>;
  system: SystemLike;
  token: { get(): Promise<string>; regenerate(): Promise<string> };
  server: ExtensionServer;
  ipc: IpcMainLike;
  /** Called with the capture the dialog should show now (null when none is left). Carries no headers. */
  onIncoming: (view: CaptureView | null) => void;
};

// Everything here is reachable from the page. The cookies that came with a capture stay in main: the page
// only ever holds a capture's id, and main looks the rest up.
export const registerCaptureIpc = (deps: CaptureIpcDeps): { dispose(): void } => {
  const { line, queue, settings, system, token, server, ipc } = deps;
  const accepting = new Set<string>();
  const saveDir = (): string => settings.get().saveDir;

  ipc.handle(CHANNELS.capturesCurrent, () => line.view());

  ipc.handle(CHANNELS.capturesPreview, (_e, id: unknown) => {
    const { url, headers } = line.take(asId(id));
    return system.preview(url, saveDir(), headers);
  });

  ipc.handle(CHANNELS.capturesAccept, async (_e, id: unknown) => {
    const captureId = asId(id);
    // A second click while the first is still queueing must not queue the same download twice.
    if (accepting.has(captureId)) throw new Error('That capture is gone.');
    // The browser's filename hint is only shown in the dialog; the saved name comes from the server's answer.
    const { url, headers } = line.take(captureId);
    accepting.add(captureId);
    try {
      await queue.add(url, saveDir(), { headers });
    } finally {
      accepting.delete(captureId);
    }
    try {
      line.accept(captureId);
    } catch {
      // The extension gave up while the link was being queued. The download is queued, so this is not an error.
    }
  });

  ipc.handle(CHANNELS.capturesDismiss, (_e, id: unknown) => line.dismiss(asId(id)));

  const status = (): ExtensionStatus => ({ enabled: settings.get().extensionEnabled, state: server.status(), port: server.port() });
  ipc.handle(CHANNELS.extensionStatus, status);
  ipc.handle(CHANNELS.extensionSetEnabled, async (_e, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('The extension must be on or off.');
    await settings.setExtensionEnabled(enabled);
    if (enabled) await server.start();
    else await server.stop();
    return status();
  });
  ipc.handle(CHANNELS.extensionGetToken, () => token.get());
  ipc.handle(CHANNELS.extensionRegenerateToken, () => token.regenerate());

  return { dispose: line.onChange(() => deps.onIncoming(line.view())) };
};

import type { DownloadQueue } from '@fetchdeck/queue';
import type { IpcMain } from 'electron';
import type { DownloadRecord, EngineEvent } from '@fetchdeck/engine';
import { join } from 'node:path';
import { CHANNELS, type AppInfo, type DownloadView, type LinkPreview } from '../shared/api';
import { createUpdateBatcher } from './updateBatcher';
import { asId, asUrl } from './validate';

export type QueueLike = Pick<DownloadQueue, 'add' | 'pause' | 'resume' | 'cancel' | 'remove' | 'list' | 'on'>;
export type IpcMainLike = Pick<IpcMain, 'handle'>;

/** Things that need Electron or the disk. Injected so the IPC wiring stays testable. */
export type SystemLike = {
  preview(url: string, saveDir: string): Promise<LinkPreview>;
  openPath(path: string): Promise<void>;
  showItemInFolder(path: string): void;
  freeBytes(dir: string): Promise<number | null>;
  deleteFile(path: string): Promise<void>;
};

type Progress = { bytesDone: number; speed: number; etaSeconds: number | null };

const segmentBytes = (record: DownloadRecord): number =>
  record.segments.reduce((sum, s) => sum + Math.min(s.downloaded, s.end - s.start + 1), 0);

export const registerIpc = (
  queue: QueueLike,
  send: (views: DownloadView[]) => void,
  ipc: IpcMainLike,
  intervalMs?: number,
  system?: SystemLike,
): { dispose(): void } => {
  const lastProgress = new Map<string, Progress>();
  const batcher = createUpdateBatcher(send, intervalMs);

  const toView = (record: DownloadRecord): DownloadView => {
    const progress = lastProgress.get(record.id);
    const finished = record.status === 'done' && record.size !== null;
    return {
      ...record,
      bytesDone: finished ? (record.size as number) : (progress?.bytesDone ?? segmentBytes(record)),
      speed: record.status === 'downloading' ? (progress?.speed ?? 0) : 0,
      etaSeconds: record.status === 'downloading' ? (progress?.etaSeconds ?? null) : null,
    };
  };

  queue.on('progress', (id: string, event: EngineEvent) => {
    if (event.type !== 'progress') return;
    lastProgress.set(id, event);
    const record = queue.list().find((r) => r.id === id);
    if (record) batcher.progress(toView(record));
  });
  queue.on('changed', (record: DownloadRecord) => batcher.status(toView(record)));
  queue.on('removed', (id: string) => lastProgress.delete(id));

  ipc.handle(CHANNELS.add, (_e, url: unknown) => queue.add(asUrl(url), defaultSaveDir()).then(() => undefined));
  ipc.handle(CHANNELS.pause, (_e, id: unknown) => queue.pause(asId(id)));
  ipc.handle(CHANNELS.resume, (_e, id: unknown) => queue.resume(asId(id)));
  ipc.handle(CHANNELS.cancel, (_e, id: unknown) => queue.cancel(asId(id)));
  ipc.handle(CHANNELS.remove, (_e, id: unknown) => queue.remove(asId(id)));
  ipc.handle(CHANNELS.list, () => queue.list().map(toView));

  const find = (id: string): DownloadRecord => {
    const record = queue.list().find((r) => r.id === id);
    if (!record) throw new Error('That download is no longer in the list');
    return record;
  };
  const filePath = (r: DownloadRecord): string => join(r.saveDir, r.filename);
  const needSystem = (): SystemLike => {
    if (!system) throw new Error('Not available');
    return system;
  };

  ipc.handle(CHANNELS.preview, (_e, url: unknown) => needSystem().preview(asUrl(url), defaultSaveDir()));
  ipc.handle(CHANNELS.info, async (): Promise<AppInfo> => ({
    saveDir: defaultSaveDir(),
    freeBytes: system ? await system.freeBytes(defaultSaveDir()) : null,
  }));
  ipc.handle(CHANNELS.openFile, (_e, id: unknown) => needSystem().openPath(filePath(find(asId(id)))));
  ipc.handle(CHANNELS.showInFolder, (_e, id: unknown) => {
    const record = find(asId(id));
    // A finished file is selected in Explorer; a partial download lives in its .part file.
    needSystem().showItemInFolder(record.status === 'done' ? filePath(record) : `${filePath(record)}.part`);
  });
  ipc.handle(CHANNELS.removeAndDelete, async (_e, id: unknown) => {
    const validId = asId(id);
    const record = find(validId);
    if (record.status === 'done') {
      await queue.remove(validId);
      await needSystem().deleteFile(filePath(record));
    } else {
      await queue.cancel(validId); // stops the download and deletes the .part file
    }
  });

  return { dispose: () => batcher.stop() };
};

let saveDir = '';
export const setDefaultSaveDir = (dir: string): void => {
  saveDir = dir;
};
const defaultSaveDir = (): string => saveDir;

import type { DownloadQueue } from '@fetchdeck/queue';
import type { IpcMain } from 'electron';
import type { DownloadRecord, EngineEvent } from '@fetchdeck/engine';
import { CHANNELS, type DownloadView } from '../shared/api';
import { createUpdateBatcher } from './updateBatcher';

export type QueueLike = Pick<DownloadQueue, 'add' | 'pause' | 'resume' | 'cancel' | 'remove' | 'list' | 'on'>;
export type IpcMainLike = Pick<IpcMain, 'handle'>;

type Progress = { bytesDone: number; speed: number; etaSeconds: number | null };

const segmentBytes = (record: DownloadRecord): number =>
  record.segments.reduce((sum, s) => sum + Math.min(s.downloaded, s.end - s.start + 1), 0);

export const registerIpc = (
  queue: QueueLike,
  send: (views: DownloadView[]) => void,
  ipc: IpcMainLike,
  intervalMs?: number,
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

  ipc.handle(CHANNELS.add, (_e, url: string) => queue.add(url, defaultSaveDir()).then(() => undefined));
  ipc.handle(CHANNELS.pause, (_e, id: string) => queue.pause(id));
  ipc.handle(CHANNELS.resume, (_e, id: string) => queue.resume(id));
  ipc.handle(CHANNELS.cancel, (_e, id: string) => queue.cancel(id));
  ipc.handle(CHANNELS.remove, (_e, id: string) => queue.remove(id));
  ipc.handle(CHANNELS.list, () => queue.list().map(toView));

  return { dispose: () => batcher.stop() };
};

let saveDir = '';
export const setDefaultSaveDir = (dir: string): void => {
  saveDir = dir;
};
const defaultSaveDir = (): string => saveDir;

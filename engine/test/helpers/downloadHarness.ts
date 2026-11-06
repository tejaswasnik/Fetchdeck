import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { Download, createRecord, type DownloadOptions } from '../../src/download';
import type { EngineEvent } from '../../src/types';

export const instantSleep = async (_ms: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export const makeDownload = async (url: string, options: Partial<DownloadOptions> = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'dl-'));
  dirs.push(root);
  const saveDir = join(root, 'out');
  const recordPath = join(root, 'record.json');
  const download = new Download(createRecord(url, saveDir), { recordPath, sleep: instantSleep, ...options });
  const events: EngineEvent[] = [];
  download.on('event', (e: EngineEvent) => events.push(e));
  const statuses = (): string[] => events.flatMap((e) => (e.type === 'status' ? [e.status] : []));
  return { download, saveDir, recordPath, events, statuses };
};

import { loadRecord } from '@fetchdeck/engine';
import { join } from 'node:path';
import { DownloadQueue } from '../../src/queue';

// Usage: crashChild <url> <saveDir> <stateDir>. Tells the parent when 2 MiB are safely on disk.
const [url, saveDir, stateDir] = process.argv.slice(2) as [string, string, string];
const queue = new DownloadQueue({ stateDir, downloadOptions: { saveProgressEveryMs: 50 } });
const id = await queue.add(url, saveDir);

const onDisk = async (): Promise<number> => {
  const record = await loadRecord(join(stateDir, `${id}.json`)).catch(() => null);
  return record?.segments.reduce((sum, s) => sum + s.downloaded, 0) ?? 0;
};

const timer = setInterval(async () => {
  if ((await onDisk()) >= 2 * 1_048_576) {
    clearInterval(timer);
    process.send?.('ready');
  }
}, 20);

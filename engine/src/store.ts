import { readFile, rename, writeFile } from 'node:fs/promises';
import { CorruptRecordError } from './errors';
import type { DownloadRecord } from './types';

// Write to a temp file then rename: a rename is all-or-nothing, so a crash
// mid-write leaves the previous record intact.
export const saveRecord = async (path: string, record: DownloadRecord): Promise<void> => {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(record));
  await rename(tmp, path);
};

export const loadRecord = async (path: string): Promise<DownloadRecord | null> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(text) as DownloadRecord;
  } catch {
    throw new CorruptRecordError(`Cannot parse ${path}`);
  }
};

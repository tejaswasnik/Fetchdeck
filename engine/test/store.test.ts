import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CorruptRecordError } from '../src/errors';
import { loadRecord, saveRecord } from '../src/store';
import type { DownloadRecord } from '../src/types';

const record: DownloadRecord = {
  id: 'a', url: 'http://x/f', finalUrl: 'http://x/f', filename: 'f', saveDir: '/tmp',
  size: 10, etag: null, lastModified: null, rangeSupported: true, status: 'queued',
  segments: [{ start: 0, end: 9, downloaded: 0 }], createdAt: '2026-01-01T00:00:00.000Z',
};

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'store-')); });
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('store', () => {
  it('save then load returns an equal record', async () => {
    const path = join(dir, 'a.json');
    await saveRecord(path, record);
    expect(await loadRecord(path)).toEqual(record);
  });

  it('no .tmp file remains after save', async () => {
    await saveRecord(join(dir, 'a.json'), record);
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('load of a missing path returns null', async () => {
    expect(await loadRecord(join(dir, 'nope.json'))).toBeNull();
  });

  it('invalid JSON throws CorruptRecordError', async () => {
    const path = join(dir, 'bad.json');
    await writeFile(path, '{not json');
    await expect(loadRecord(path)).rejects.toBeInstanceOf(CorruptRecordError);
  });
});

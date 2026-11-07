import { open, readFile, rm } from 'node:fs/promises';
import { CorruptRecordError } from './errors';
import { renameWithRetry } from './renameRetry';
import type { DownloadRecord, DownloadStatus, SegmentState } from './types';

const STATUSES: readonly DownloadStatus[] = ['queued', 'downloading', 'waiting', 'paused', 'done', 'error'];

const field = (value: object, key: string): unknown => Reflect.get(value, key);

const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isSegment = (value: unknown): value is SegmentState => {
  if (typeof value !== 'object' || value === null) return false;
  const start = field(value, 'start');
  const end = field(value, 'end');
  return isOffset(start) && isOffset(end) && end >= start && isOffset(field(value, 'downloaded'));
};

const isNullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

export const isDownloadRecord = (value: unknown): value is DownloadRecord => {
  if (typeof value !== 'object' || value === null) return false;
  const size = field(value, 'size');
  const status = field(value, 'status');
  const segments = field(value, 'segments');
  const error = field(value, 'error');
  return (
    typeof field(value, 'id') === 'string' &&
    typeof field(value, 'url') === 'string' &&
    typeof field(value, 'finalUrl') === 'string' &&
    typeof field(value, 'filename') === 'string' &&
    typeof field(value, 'saveDir') === 'string' &&
    (size === null || isOffset(size)) &&
    isNullableString(field(value, 'etag')) &&
    isNullableString(field(value, 'lastModified')) &&
    typeof field(value, 'rangeSupported') === 'boolean' &&
    STATUSES.some((s) => s === status) &&
    Array.isArray(segments) &&
    segments.every(isSegment) &&
    (error === undefined || typeof error === 'string') &&
    typeof field(value, 'createdAt') === 'string'
  );
};

// Saves of the same record run one after another, so two overlapping saves can never fight over the temp file.
const pending = new Map<string, Promise<void>>();

export const writeFileAtomic = async (path: string, text: string): Promise<void> => {
  const tmp = `${path}.tmp`;
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(text);
      await handle.sync(); // a power cut must not leave an empty record after the rename
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
};

// Write to a temp file then rename: a rename is all-or-nothing, so a crash
// mid-write leaves the previous record intact.
export const saveRecord = (path: string, record: DownloadRecord): Promise<void> => {
  const text = JSON.stringify(record); // snapshot now; the record keeps changing while we wait our turn
  const run = (pending.get(path) ?? Promise.resolve()).catch(() => undefined).then(() => writeFileAtomic(path, text));
  const tail = run.catch(() => undefined);
  pending.set(path, tail);
  void tail.then(() => {
    if (pending.get(path) === tail) pending.delete(path);
  });
  return run;
};

// Waits for every save already queued for this record, then deletes it, so a late save cannot bring a removed record back.
export const deleteRecord = async (path: string): Promise<void> => {
  await (pending.get(path) ?? Promise.resolve());
  await rm(path, { force: true });
};

export const loadRecord = async (path: string): Promise<DownloadRecord | null> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CorruptRecordError(`Cannot parse ${path}`);
  }
  if (!isDownloadRecord(parsed)) throw new CorruptRecordError(`Unexpected contents in ${path}`);
  return parsed;
};

import { readFile } from 'node:fs/promises';
import { CorruptRecordError, writeFileAtomic } from '@fetchdeck/engine';

// Saves to one path run one after another, so two overlapping saves can never fight over the temp file.
const pending = new Map<string, Promise<void>>();

const isIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const saveOrder = (path: string, ids: string[]): Promise<void> => {
  const text = JSON.stringify(ids); // snapshot now; the line keeps changing while we wait our turn
  const run = (pending.get(path) ?? Promise.resolve()).catch(() => undefined).then(() => writeFileAtomic(path, text));
  const tail = run.catch(() => undefined);
  pending.set(path, tail);
  void tail.then(() => {
    if (pending.get(path) === tail) pending.delete(path);
  });
  return run;
};

export const loadOrder = async (path: string): Promise<string[] | null> => {
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
  if (!isIdList(parsed)) throw new CorruptRecordError(`Unexpected contents in ${path}`);
  return parsed;
};

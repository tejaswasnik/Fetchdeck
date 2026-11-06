import { rename } from 'node:fs/promises';

type Rename = (from: string, to: string) => Promise<void>;

export type RenameRetryOptions = {
  rename?: Rename;
  delaysMs?: readonly number[]; // one retry per entry
  sleep?: (ms: number) => Promise<void>;
};

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_DELAYS_MS = [50, 100, 200, 400, 500];

const isTransient = (err: unknown): boolean =>
  err instanceof Error && TRANSIENT.has((err as NodeJS.ErrnoException).code ?? '');

// On Windows an antivirus scanner, the search indexer or a reader can hold a file for a moment,
// which makes rename fail with EPERM/EBUSY/EACCES. Waiting briefly and trying again nearly always works.
export const renameWithRetry = async (
  from: string,
  to: string,
  { rename: doRename = rename, delaysMs = DEFAULT_DELAYS_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: RenameRetryOptions = {},
): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    try {
      await doRename(from, to);
      return;
    } catch (err) {
      const delay = delaysMs[attempt];
      if (!isTransient(err) || delay === undefined) throw err;
      await sleep(delay);
    }
  }
};

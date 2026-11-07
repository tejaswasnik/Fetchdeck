import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pickAllowedHeaders, writeFileAtomic, type RequestHeaders } from '@fetchdeck/engine';
import { CredentialsUnavailableError, type AuthStore } from '@fetchdeck/queue';

/** The part of Electron's `safeStorage` the app uses. Injected so the stores run (and are tested) without Electron. */
export type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
};

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const EXTENSION = '.auth';

const asSafeId = (id: string): string => {
  if (!SAFE_ID.test(id)) throw new Error('Unknown download.');
  return id;
};

// Credentials live in `<id>.auth`, encrypted with the operating system's key store (DPAPI on Windows).
// Without encryption nothing secret is ever written: memory serves this run, and an empty marker file
// records that credentials existed, so a restart can say "needs the link from your browser again".
export const createSafeStorageAuthStore = (options: { dir: string; safeStorage: SafeStorageLike }): AuthStore => {
  const { dir, safeStorage } = options;
  const memory = new Map<string, RequestHeaders>();
  const fileOf = (id: string): string => join(dir, `${asSafeId(id)}${EXTENSION}`);

  return {
    async save(id, headers) {
      const file = fileOf(id);
      await mkdir(dir, { recursive: true });
      memory.set(id, { ...headers });
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(JSON.stringify(headers)).toString('base64') : '';
      await writeFileAtomic(file, text);
    },

    async load(id) {
      const file = fileOf(id);
      const cached = memory.get(id);
      if (cached) return { ...cached };
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; // this download never had credentials
        throw new CredentialsUnavailableError();
      }
      if (text === '' || !safeStorage.isEncryptionAvailable()) throw new CredentialsUnavailableError();
      try {
        const headers = pickAllowedHeaders(JSON.parse(safeStorage.decryptString(Buffer.from(text, 'base64'))));
        memory.set(id, headers);
        return { ...headers };
      } catch {
        throw new CredentialsUnavailableError(); // corrupt, or saved by another account
      }
    },

    async delete(id) {
      const file = fileOf(id);
      memory.delete(id);
      await rm(file, { force: true });
    },

    async ids() {
      try {
        return (await readdir(dir)).filter((name) => name.endsWith(EXTENSION)).map((name) => name.slice(0, -EXTENSION.length));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },
  };
};

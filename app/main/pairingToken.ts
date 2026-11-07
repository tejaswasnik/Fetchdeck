import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomic } from '@fetchdeck/engine';
import type { SafeStorageLike } from './authStore';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes as base64url

export type PairingToken = { get(): Promise<string>; regenerate(): Promise<string> };

// The secret the browser extension must present. Encrypted on disk; without encryption it lives in memory
// only, so each launch makes a new one and the extension has to be paired again.
export const createPairingToken = (options: { path: string; safeStorage: SafeStorageLike }): PairingToken => {
  const { path, safeStorage } = options;
  let current: Promise<string> | null = null;

  const readSaved = async (): Promise<string | null> => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const text = safeStorage.decryptString(Buffer.from(await readFile(path, 'utf8'), 'base64'));
      return TOKEN_PATTERN.test(text) ? text : null;
    } catch {
      return null; // missing or corrupt: a fresh token replaces it
    }
  };

  const persist = async (token: string): Promise<void> => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        await rm(path, { force: true }); // never leave an old token behind that no longer matches
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFileAtomic(path, safeStorage.encryptString(token).toString('base64'));
    } catch {
      // The token still works for this run; it just will not survive a restart.
    }
  };

  const create = async (): Promise<string> => {
    const token = randomBytes(32).toString('base64url');
    await persist(token);
    return token;
  };

  return {
    get: () => (current ??= readSaved().then((saved) => saved ?? create())),
    regenerate: () => (current = create()),
  };
};

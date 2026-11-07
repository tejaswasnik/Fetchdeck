import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialsUnavailableError } from '@fetchdeck/queue';
import { createSafeStorageAuthStore, type SafeStorageLike } from '../main/authStore';

const CREDENTIALS = { Cookie: 'sid=SECRET', Referer: 'https://site.example/p', 'User-Agent': 'UA/1' };

// A stand-in for Electron's safeStorage: not real encryption, but the bytes on disk differ from the text.
const fakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a)),
  decryptString: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString('utf8'),
});

let dir: string;
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'fetchdeck-auth-')), 'auth');
});
afterEach(() => rm(join(dir, '..'), { recursive: true, force: true }));

const everythingOnDisk = async (): Promise<string> => {
  const names = await readdir(dir);
  const contents = await Promise.all(names.map(async (n) => (await readFile(join(dir, n))).toString('latin1')));
  return contents.join('\n');
};

describe('safeStorage auth store', () => {
  it('round-trips credentials, also in a new store over the same folder (a restart), without plaintext on disk', async () => {
    const first = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage() });
    await first.save('a1', CREDENTIALS);
    expect(await first.load('a1')).toEqual(CREDENTIALS);
    expect(await everythingOnDisk()).not.toContain('SECRET');
    expect(await readdir(dir)).toEqual(['a1.auth']);

    const restarted = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage() });
    expect(await restarted.load('a1')).toEqual(CREDENTIALS);
  });

  it('returns null for an id that never had credentials', async () => {
    const store = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage() });
    expect(await store.load('nothing')).toBeNull();
  });

  it('delete removes the file and ids() lists what is saved', async () => {
    const store = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage() });
    await store.save('a1', CREDENTIALS);
    await store.save('b2', { Cookie: 'x=1' });
    expect((await store.ids()).sort()).toEqual(['a1', 'b2']);
    await store.delete('a1');
    expect(await store.ids()).toEqual(['b2']);
    expect(await store.load('a1')).toBeNull();
    await store.delete('a1'); // deleting twice is fine
  });

  it('without encryption: nothing secret reaches the disk, memory serves the same store, a restart says the link is needed again', async () => {
    const store = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage(false) });
    await store.save('a1', CREDENTIALS);
    expect(await store.load('a1')).toEqual(CREDENTIALS);
    expect(await everythingOnDisk()).not.toContain('SECRET');
    expect(await store.ids()).toEqual(['a1']);

    const restarted = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage(false) });
    await expect(restarted.load('a1')).rejects.toBeInstanceOf(CredentialsUnavailableError);
    await expect(restarted.load('a1')).rejects.toThrow('Needs the link from your browser again');
    expect(await restarted.load('never-saved')).toBeNull();
  });

  it('a file that cannot be decrypted (corrupt, or saved on another account) says the link is needed again', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a1.auth'), 'not-base64-ciphertext-!!');
    const store = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage() });
    await expect(store.load('a1')).rejects.toBeInstanceOf(CredentialsUnavailableError);
  });

  it('refuses ids that could leave the folder', async () => {
    const store = createSafeStorageAuthStore({ dir, safeStorage: fakeSafeStorage() });
    await expect(store.save('../evil', CREDENTIALS)).rejects.toThrow('Unknown download.');
    await expect(store.load('a/b')).rejects.toThrow('Unknown download.');
    await expect(store.delete('..')).rejects.toThrow('Unknown download.');
  });
});

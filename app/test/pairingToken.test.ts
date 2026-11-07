import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SafeStorageLike } from '../main/authStore';
import { createPairingToken } from '../main/pairingToken';

const fakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) => Buffer.from(Buffer.from(text, 'utf8').map((byte) => byte ^ 0x5a)),
  decryptString: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString('utf8'),
});

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fetchdeck-token-'));
  path = join(dir, 'pairing.token');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('pairing token', () => {
  it('is 43 characters of base64url and the same on every get(), also after a restart', async () => {
    const first = createPairingToken({ path, safeStorage: fakeSafeStorage() });
    const token = await first.get();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await first.get()).toBe(token);
    expect(await createPairingToken({ path, safeStorage: fakeSafeStorage() }).get()).toBe(token);
  });

  it('two get() calls at once still agree', async () => {
    const store = createPairingToken({ path, safeStorage: fakeSafeStorage() });
    const [a, b] = await Promise.all([store.get(), store.get()]);
    expect(a).toBe(b);
  });

  it('regenerate() changes it at once and for good', async () => {
    const store = createPairingToken({ path, safeStorage: fakeSafeStorage() });
    const old = await store.get();
    const next = await store.regenerate();
    expect(next).not.toBe(old);
    expect(await store.get()).toBe(next);
    expect(await createPairingToken({ path, safeStorage: fakeSafeStorage() }).get()).toBe(next);
  });

  it('is not written to disk in plain text', async () => {
    const token = await createPairingToken({ path, safeStorage: fakeSafeStorage() }).get();
    expect((await readFile(path)).toString('latin1')).not.toContain(token);
  });

  it('a corrupt token file is replaced by a fresh token instead of failing', async () => {
    await writeFile(path, 'garbage');
    const store = createPairingToken({ path, safeStorage: fakeSafeStorage() });
    const token = await store.get();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await createPairingToken({ path, safeStorage: fakeSafeStorage() }).get()).toBe(token);
  });

  it('without encryption: kept in memory only, nothing written, a restart makes a new one', async () => {
    const store = createPairingToken({ path, safeStorage: fakeSafeStorage(false) });
    const token = await store.get();
    expect(await store.get()).toBe(token);
    expect(existsSync(path)).toBe(false);
    expect(await createPairingToken({ path, safeStorage: fakeSafeStorage(false) }).get()).not.toBe(token);
  });
});

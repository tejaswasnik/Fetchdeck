import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAuthStore } from '../src/authStore';
import { DownloadQueue } from '../src/queue';

// One fixed id, so the test can block exactly that record file.
vi.mock('node:crypto', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:crypto')>()), randomUUID: () => 'fixed-id' }));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'queue-auth-fail-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('DownloadQueue credentials when the record cannot be saved', () => {
  it('removes the credentials it just saved and leaves nothing in the list', async () => {
    const stateDir = join(root, 'state');
    await mkdir(join(stateDir, 'fixed-id.json'), { recursive: true }); // a directory where the record file must go
    const store = createMemoryAuthStore();
    const queue = new DownloadQueue({ stateDir, authStore: store });
    await expect(queue.add('http://127.0.0.1:1/f', join(root, 'out'), { headers: { Cookie: 'sid=SECRET' } })).rejects.toThrow();
    expect(await store.ids()).toEqual([]);
    expect(queue.list()).toEqual([]);
    await queue.shutdown();
  });
});

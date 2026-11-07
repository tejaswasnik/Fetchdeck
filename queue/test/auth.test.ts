import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecord, saveRecord, type DownloadRecord } from '@fetchdeck/engine';
import { startFakeServer, type FakeServer } from '../../engine/test/helpers/fakeServer';
import { createMemoryAuthStore, CredentialsUnavailableError, type AuthStore } from '../src/authStore';
import { DownloadQueue, type QueueOptions } from '../src/queue';

const MIB = 1_048_576;
const CREDENTIALS = { Cookie: 'sid=SECRET', Referer: 'https://site.example/p', 'User-Agent': 'UA/1' };

let server: FakeServer | undefined;
let root: string;
let stateDir: string;
let saveDir: string;
const queues: DownloadQueue[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'queue-auth-'));
  stateDir = join(root, 'state');
  saveDir = join(root, 'out');
});
afterEach(async () => {
  await Promise.all(queues.map((q) => q.shutdown()));
  queues.length = 0;
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

const makeQueue = (authStore: AuthStore, options: Partial<QueueOptions> = {}) => {
  const queue = new DownloadQueue({ stateDir, maxSegments: 1, authStore, ...options });
  queues.push(queue);
  return queue;
};

const waitFor = async (condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> => {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const statusOf = (queue: DownloadQueue, id: string) => queue.list().find((r) => r.id === id)?.status;

describe('memory auth store', () => {
  it('saves, loads, lists and deletes', async () => {
    const store = createMemoryAuthStore();
    await store.save('a', { Cookie: 'x=1' });
    expect(await store.load('a')).toEqual({ Cookie: 'x=1' });
    expect(await store.load('missing')).toBeNull();
    expect(await store.ids()).toEqual(['a']);
    await store.delete('a');
    expect(await store.ids()).toEqual([]);
  });
});

describe('DownloadQueue credentials', () => {
  it('saves them before the record, and the download sends them', async () => {
    server = await startFakeServer({ size: MIB });
    const store = createMemoryAuthStore();
    const seenRecordAtSave: boolean[] = [];
    const spying: AuthStore = {
      ...store,
      save: async (id, headers) => {
        seenRecordAtSave.push(existsSync(join(stateDir, `${id}.json`)));
        await store.save(id, headers);
      },
    };
    const queue = makeQueue(spying);
    const id = await queue.add(`${server.url}/file`, saveDir, { headers: CREDENTIALS });
    expect(seenRecordAtSave).toEqual([false]);
    await waitFor(() => statusOf(queue, id) === 'done');
    expect(server.requests.length).toBeGreaterThan(0);
    for (const request of server.requests) {
      expect(request.headers.cookie).toBe('sid=SECRET');
      expect(request.headers['user-agent']).toBe('UA/1');
    }
  });

  it('deletes them when the download finishes', async () => {
    server = await startFakeServer({ size: MIB });
    const store = createMemoryAuthStore();
    const queue = makeQueue(store);
    const id = await queue.add(`${server.url}/file`, saveDir, { headers: CREDENTIALS });
    await waitFor(() => statusOf(queue, id) === 'done');
    await waitFor(async () => (await store.ids()).length === 0);
  });

  it('deletes them on cancel', async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const store = createMemoryAuthStore();
    const queue = makeQueue(store);
    const id = await queue.add(`${server.url}/file`, saveDir, { headers: CREDENTIALS });
    await waitFor(() => statusOf(queue, id) === 'downloading');
    expect(await store.ids()).toEqual([id]);
    await queue.cancel(id);
    expect(await store.ids()).toEqual([]);
  });

  it('keeps them on error so Retry still sends them, deletes them on remove', async () => {
    server = await startFakeServer({ size: MIB });
    server.failNext(404, 1); // the first probe is refused for good
    const store = createMemoryAuthStore();
    const queue = makeQueue(store);
    const id = await queue.add(`${server.url}/file`, saveDir, { headers: CREDENTIALS });
    await waitFor(() => statusOf(queue, id) === 'error');
    expect(await store.ids()).toEqual([id]);

    // The status changes a moment before the queue lets go of the failed download; Retry works once it has.
    await waitFor(async () => {
      await queue.resume(id);
      return statusOf(queue, id) !== 'error';
    });
    await waitFor(() => statusOf(queue, id) === 'done');
    expect(server.requests.at(-1)?.headers.cookie).toBe('sid=SECRET');

    server.failNext(404, 1);
    const second = await queue.add(`${server.url}/file`, saveDir, { headers: CREDENTIALS });
    await waitFor(() => statusOf(queue, second) === 'error');
    expect(await store.ids()).toEqual([second]);
    // The queue lets go of a failed download a moment after its status changes.
    await waitFor(async () => queue.remove(second).then(() => true, () => false));
    expect(await store.ids()).toEqual([]);
  });

  it('load() deletes credentials that match no record and keeps those of paused downloads', async () => {
    const store = createMemoryAuthStore();
    await store.save('ghost', CREDENTIALS);
    const kept: DownloadRecord = { ...createRecord('http://127.0.0.1:1/f', saveDir, 'kept'), status: 'paused' };
    await mkdir(stateDir, { recursive: true });
    await saveRecord(join(stateDir, 'kept.json'), kept);
    await store.save('kept', CREDENTIALS);
    const queue = makeQueue(store);
    await queue.load();
    expect((await store.ids()).sort()).toEqual(['kept']);
  });

  it('a download added without headers never saves anything to the store', async () => {
    server = await startFakeServer({ size: MIB });
    const calls: string[] = [];
    const store = createMemoryAuthStore();
    const spying: AuthStore = {
      save: async (...args) => (calls.push('save'), store.save(...args)),
      load: async (...args) => (calls.push('load'), store.load(...args)),
      delete: async (...args) => (calls.push('delete'), store.delete(...args)),
      ids: store.ids,
    };
    const queue = makeQueue(spying);
    const id = await queue.add(`${server.url}/file`, saveDir);
    await waitFor(() => statusOf(queue, id) === 'done');
    expect(calls).not.toContain('save');
    expect(await store.ids()).toEqual([]);
  });

  it('record files never contain the cookie value', async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const queue = makeQueue(createMemoryAuthStore());
    const id = await queue.add(`${server.url}/file`, saveDir, { headers: CREDENTIALS });
    await waitFor(() => statusOf(queue, id) === 'downloading');
    await queue.pause(id);
    for (const name of await readdir(stateDir)) {
      expect(await readFile(join(stateDir, name), 'utf8')).not.toContain('SECRET');
    }
  });

  it('a store that cannot produce the credentials ends the download in error with a plain message', async () => {
    server = await startFakeServer({ size: MIB });
    const failing: AuthStore = {
      ...createMemoryAuthStore(),
      load: async () => {
        throw new CredentialsUnavailableError();
      },
    };
    const queue = makeQueue(failing);
    const id = await queue.add(`${server.url}/file`, saveDir, { headers: CREDENTIALS });
    await waitFor(() => statusOf(queue, id) === 'error');
    expect(queue.list()[0]?.error).toBe('Needs the link from your browser again');
  });
});

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvalidUrlError, loadRecord, saveRecord, type DownloadRecord, createRecord } from '@fetchdeck/engine';
import { startFakeServer, type FakeServer } from '../../engine/test/helpers/fakeServer';
import { DownloadQueue, type QueueOptions } from '../src/queue';

const MIB = 1_048_576;
let server: FakeServer | undefined;
let root: string;
let stateDir: string;
let saveDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'queue-'));
  stateDir = join(root, 'state');
  saveDir = join(root, 'out');
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

const makeQueue = (options: Partial<QueueOptions> = {}) => {
  const queue = new DownloadQueue({ stateDir, maxSegments: 1, ...options });
  const changes: DownloadRecord[] = [];
  const snapshots: { id: string; status: string }[] = [];
  queue.on('changed', (r: DownloadRecord) => {
    changes.push(r);
    snapshots.push({ id: r.id, status: r.status });
  });
  return { queue, changes, snapshots };
};

const waitFor = async (condition: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const statusOf = (queue: DownloadQueue, id: string) => queue.list().find((r) => r.id === id)?.status;

describe('DownloadQueue', () => {
  it('5 downloads never run more than 3 at once', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: MIB, bytesPerSecPerConnection: 2 * MIB });
    const { queue } = makeQueue();
    let peak = 0;
    queue.on('changed', () => {
      const running = queue.list().filter((r) => r.status === 'downloading' || r.status === 'waiting').length;
      peak = Math.max(peak, running);
      expect(running).toBeLessThanOrEqual(3);
    });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await queue.add(`${server.url}/file`, join(saveDir, String(i))));
    await waitFor(() => ids.every((id) => statusOf(queue, id) === 'done'));
    expect(peak).toBe(3);
  });

  it('start order is add order', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: MIB });
    const { queue, snapshots } = makeQueue({ maxConcurrent: 1 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await queue.add(`${server.url}/file`, join(saveDir, String(i))));
    await waitFor(() => ids.every((id) => statusOf(queue, id) === 'done'));
    const startOrder = snapshots.filter((s) => s.status === 'downloading').map((s) => s.id);
    expect([...new Set(startOrder)]).toEqual(ids);
  });

  it('pausing a running one starts the next', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const { queue } = makeQueue({ maxConcurrent: 1 });
    const a = await queue.add(`${server.url}/file`, join(saveDir, 'a'));
    const b = await queue.add(`${server.url}/file`, join(saveDir, 'b'));
    await waitFor(() => statusOf(queue, a) === 'downloading');
    expect(statusOf(queue, b)).toBe('queued');
    await queue.pause(a);
    await waitFor(() => statusOf(queue, b) === 'downloading');
    expect(statusOf(queue, a)).toBe('paused');
    await queue.cancel(b);
  });

  it('resume puts it at the back', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const { queue } = makeQueue({ maxConcurrent: 1 });
    const a = await queue.add(`${server.url}/file`, join(saveDir, 'a'));
    const b = await queue.add(`${server.url}/file`, join(saveDir, 'b'));
    const c = await queue.add(`${server.url}/file`, join(saveDir, 'c'));
    await waitFor(() => statusOf(queue, a) === 'downloading');
    await queue.pause(a);
    await waitFor(() => statusOf(queue, b) === 'downloading');
    await queue.resume(a);
    expect(queue.list().map((r) => r.id)).toEqual([b, c, a]);
    for (const id of [a, b, c]) await queue.cancel(id);
  });

  it('cancel removes the .part and the record file', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const { queue } = makeQueue();
    const id = await queue.add(`${server.url}/file`, saveDir);
    await waitFor(() => (queue.list()[0]?.segments[0]?.downloaded ?? 0) > 0);
    await queue.cancel(id);
    expect(existsSync(join(stateDir, `${id}.json`))).toBe(false);
    expect(await readdir(saveDir)).toEqual([]);
    expect(queue.list()).toEqual([]);
  });

  it('remove keeps the finished file', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: MIB });
    const { queue } = makeQueue();
    const id = await queue.add(`${server.url}/file`, saveDir);
    await waitFor(() => statusOf(queue, id) === 'done');
    await queue.remove(id);
    expect(queue.list()).toEqual([]);
    expect(existsSync(join(stateDir, `${id}.json`))).toBe(false);
    expect(createHash('sha256').update(await readFile(join(saveDir, 'file'))).digest('hex')).toBe(server.sha256);
  });

  it('add("ftp://x") rejects with InvalidUrlError and saves nothing', async () => {
    const { queue } = makeQueue();
    await expect(queue.add('ftp://x', saveDir)).rejects.toBeInstanceOf(InvalidUrlError);
    expect(queue.list()).toEqual([]);
    expect(existsSync(stateDir) ? await readdir(stateDir) : []).toEqual([]);
  });

  it('each status change is saved to <stateDir>/<id>.json', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const { queue } = makeQueue();
    const id = await queue.add(`${server.url}/file`, saveDir);
    const path = join(stateDir, `${id}.json`);
    expect((await loadRecord(path))?.status).toBe('queued');
    await waitFor(() => statusOf(queue, id) === 'downloading');
    await queue.pause(id);
    expect((await loadRecord(path))?.status).toBe('paused');
    server.setThrottle(undefined);
    await queue.resume(id);
    // The in-memory status flips just before the file is written, so wait on the file itself.
    let onDisk = await loadRecord(path);
    await waitFor(() => statusOf(queue, id) === 'done');
    while (onDisk?.status !== 'done') {
      await new Promise((r) => setTimeout(r, 10));
      onDisk = await loadRecord(path);
    }
    expect(onDisk.status).toBe('done');
  });
});

describe('DownloadQueue.shutdown', () => {
  it('leaves every running download paused with a record that matches the file on disk', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 8 * MIB, bytesPerSecPerConnection: MIB });
    const { queue } = makeQueue({ maxSegments: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) ids.push(await queue.add(`${server.url}/file`, join(saveDir, String(i))));
    await waitFor(() => ids.every((id) => (queue.list().find((r) => r.id === id)?.segments[0]?.downloaded ?? 0) > 0));

    await queue.shutdown();

    for (const [i, id] of ids.entries()) {
      const onDisk = await loadRecord(join(stateDir, `${id}.json`));
      expect(onDisk?.status).toBe('paused');
      expect(statusOf(queue, id)).toBe('paused');
      const part = await readFile(join(saveDir, String(i), `${onDisk!.filename}.part`));
      for (const segment of onDisk!.segments) {
        const end = segment.start + segment.downloaded;
        expect(part.subarray(segment.start, end).equals(server.data.subarray(segment.start, end))).toBe(true);
      }
    }
    expect(queue.hasActive()).toBe(false);
  });

  it('a second call is a no-op and nothing new starts afterwards', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const { queue } = makeQueue({ maxConcurrent: 1 });
    const a = await queue.add(`${server.url}/file`, join(saveDir, 'a'));
    const b = await queue.add(`${server.url}/file`, join(saveDir, 'b'));
    await waitFor(() => statusOf(queue, a) === 'downloading');
    await queue.shutdown();
    await queue.shutdown();
    expect(statusOf(queue, a)).toBe('paused');
    expect(statusOf(queue, b)).toBe('queued');
  });
});

describe('DownloadQueue.load', () => {
  const seed = async (id: string, patch: Partial<DownloadRecord>): Promise<DownloadRecord> => {
    await mkdir(stateDir, { recursive: true });
    const record: DownloadRecord = {
      ...createRecord('http://127.0.0.1:1/file', saveDir, id),
      filename: 'file', size: 100, rangeSupported: true, status: 'downloading',
      segments: [{ start: 0, end: 99, downloaded: 40 }], ...patch,
    };
    await saveRecord(join(stateDir, `${id}.json`), record);
    return record;
  };
  const writePart = async (size: number): Promise<void> => {
    await mkdir(saveDir, { recursive: true });
    await writeFile(join(saveDir, 'file.part'), Buffer.alloc(size));
  };

  it('downloading records load as paused', async () => {
    await writePart(100);
    await seed('a', { status: 'downloading' });
    await seed('b', { status: 'waiting', createdAt: '2999-01-01' });
    const { queue } = makeQueue();
    await queue.load();
    expect(queue.list().map((r) => r.status)).toEqual(['paused', 'paused']);
    expect(queue.list()[0]!.segments[0]!.downloaded).toBe(40);
  });

  it.each(['queued', 'waiting', 'downloading'] as const)('a %s record comes back paused and nothing auto-starts', async (status) => {
    await writePart(100);
    await seed('a', { status });
    const { queue, snapshots } = makeQueue();
    await queue.load();
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.list().map((r) => r.status)).toEqual(['paused']);
    expect(snapshots.every((s) => s.status === 'paused')).toBe(true);
    expect((await loadRecord(join(stateDir, 'a.json')))?.status).toBe('paused');
  });

  it('missing .part restarts from zero', async () => {
    await seed('a', {});
    const { queue } = makeQueue();
    await queue.load();
    expect(queue.list()[0]!.segments[0]!.downloaded).toBe(0);
  });

  it('wrong-size .part restarts from zero', async () => {
    await writePart(7);
    await seed('a', {});
    const { queue } = makeQueue();
    await queue.load();
    expect(queue.list()[0]!.segments[0]!.downloaded).toBe(0);
  });

  it('a corrupt json is skipped with a warning; others still load', async () => {
    await writePart(100);
    await seed('good', {});
    await writeFile(join(stateDir, 'bad.json'), '{oops');
    const { queue } = makeQueue();
    const warnings: string[] = [];
    queue.on('warning', (m: string) => warnings.push(m));
    await queue.load();
    expect(queue.list().map((r) => r.id)).toEqual(['good']);
    expect(warnings).toHaveLength(1);
  });

  it('a valid-JSON record with the wrong shape is skipped; the good one stays', async () => {
    await writePart(100);
    await seed('good', {});
    await writeFile(join(stateDir, 'odd.json'), JSON.stringify({ id: 'odd', status: 'sleeping' }));
    const { queue } = makeQueue();
    const warnings: string[] = [];
    queue.on('warning', (m: string) => warnings.push(m));
    await queue.load();
    expect(queue.list().map((r) => r.id)).toEqual(['good']);
    expect(warnings).toEqual(['Skipped unreadable download record odd.json']);
  });
});

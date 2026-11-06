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
// Every queue a test creates is tracked so afterEach can stop it (and let any in-flight state write finish) before the temp dir goes away.
const queues: DownloadQueue[] = [];

afterEach(async () => {
  await Promise.all(queues.map((q) => q.shutdown()));
  queues.length = 0;
  await server?.close();
  server = undefined;
  await rm(root, { recursive: true, force: true });
});

const makeQueue = (options: Partial<QueueOptions> = {}) => {
  const queue = new DownloadQueue({ stateDir, maxSegments: 1, ...options });
  queues.push(queue);
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

  it('remove works the moment a download reports done', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: MIB });
    const { queue } = makeQueue();
    const id = await queue.add(`${server.url}/file`, saveDir);
    const finished = new Promise<void>((resolve) => {
      queue.on('changed', (r: DownloadRecord) => {
        if (r.id === id && r.status === 'done') resolve();
      });
    });
    await finished;
    await expect(queue.remove(id)).resolves.toBeUndefined();
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

describe('persisted order', () => {
  const seed = async (id: string, createdAt: string): Promise<void> => {
    await mkdir(stateDir, { recursive: true });
    const record: DownloadRecord = {
      ...createRecord('http://127.0.0.1:1/file', saveDir, id),
      filename: 'file', size: 100, rangeSupported: true, status: 'paused',
      segments: [{ start: 0, end: 99, downloaded: 0 }], createdAt,
    };
    await saveRecord(join(stateDir, `${id}.json`), record);
  };
  const seedThree = async (): Promise<void> => {
    await seed('a', '2026-01-01T00:00:00.000Z');
    await seed('b', '2026-01-02T00:00:00.000Z');
    await seed('c', '2026-01-03T00:00:00.000Z');
  };
  const writeOrder = (text: string) => writeFile(join(stateDir, 'order.json'), text);

  it('load follows order.json, not createdAt', async () => {
    await seedThree();
    await writeOrder(JSON.stringify(['c', 'a', 'b']));
    const { queue } = makeQueue();
    await queue.load();
    expect(queue.list().map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('ids missing from order.json go last by createdAt; unknown and repeated ids are ignored', async () => {
    await seedThree();
    await writeOrder(JSON.stringify(['ghost', 'b', 'b', 'ghost2']));
    const { queue } = makeQueue();
    await queue.load();
    expect(queue.list().map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('a corrupt order.json warns and falls back to createdAt', async () => {
    await seedThree();
    await writeOrder('{oops');
    const { queue } = makeQueue();
    const warnings: string[] = [];
    queue.on('warning', (m: string) => warnings.push(m));
    await queue.load();
    expect(queue.list().map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(warnings).toEqual(['Skipped unreadable queue order']);
  });

  it('an order.json that cannot be read at all warns and falls back to createdAt', async () => {
    await seedThree();
    await mkdir(join(stateDir, 'order.json')); // reading a directory fails with EISDIR, not ENOENT
    const { queue } = makeQueue();
    const warnings: string[] = [];
    queue.on('warning', (m: string) => warnings.push(m));
    await queue.load();
    expect(queue.list().map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(warnings[0]).toBe('Skipped unreadable queue order');
  });

  it('order.json is never read as a record', async () => {
    await seedThree();
    await writeOrder(JSON.stringify(['c', 'a', 'b']));
    const { queue } = makeQueue();
    const warnings: string[] = [];
    queue.on('warning', (m: string) => warnings.push(m));
    await queue.load();
    expect(warnings).toEqual([]);
  });

  it('resume sends an item to the back and that survives a restart', async () => {
    await seedThree();
    const first = makeQueue();
    await first.queue.load();
    await first.queue.shutdown(); // nothing may start when resume schedules
    await first.queue.resume('a');
    expect(first.queue.list().map((r) => r.id)).toEqual(['b', 'c', 'a']);
    const second = makeQueue();
    await second.queue.load();
    expect(second.queue.list().map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('reordering', () => {
  const ids = (queue: DownloadQueue) => queue.list().map((r) => r.id);
  const recordReorders = (queue: DownloadQueue): string[][] => {
    const reorders: string[][] = [];
    queue.on('reordered', (order: string[]) => reorders.push(order));
    return reorders;
  };
  const sha256Of = async (dir: string): Promise<string> =>
    createHash('sha256').update(await readFile(join(dir, 'file'))).digest('hex');
  // maxConcurrent 1 on a throttled server: the first one runs, the rest wait in line.
  const lineOf = async (count: number, size = 4 * MIB) => {
    server = await startFakeServer({ size, bytesPerSecPerConnection: MIB });
    const made = makeQueue({ maxConcurrent: 1 });
    const added: string[] = [];
    for (let i = 0; i < count; i++) added.push(await made.queue.add(`${server.url}/file`, join(saveDir, String(i))));
    await waitFor(() => statusOf(made.queue, added[0]!) === 'downloading');
    return { ...made, added };
  };

  it('moveUp swaps a queued item with the nearest queued neighbour and emits reordered', { timeout: 30_000 }, async () => {
    const { queue, added } = await lineOf(4);
    const [a, b, c, d] = added as [string, string, string, string];
    await queue.pause(c);
    const reorders = recordReorders(queue);
    await queue.moveUp(d); // skips the paused c and the running a
    expect(ids(queue)).toEqual([a, d, c, b]);
    await queue.moveDown(d);
    expect(ids(queue)).toEqual([a, b, c, d]);
    expect(reorders).toEqual([[a, d, c, b], [a, b, c, d]]);
    expect(JSON.parse(await readFile(join(stateDir, 'order.json'), 'utf8'))).toEqual([a, b, c, d]);
    await queue.shutdown();
  });

  it('moveUp on the first item, moveDown on the last, and on a non-queued item do nothing and emit nothing', { timeout: 30_000 }, async () => {
    const { queue, added } = await lineOf(4);
    const [a, b, c, d] = added as [string, string, string, string];
    await queue.pause(c);
    const reorders = recordReorders(queue);
    await queue.moveUp(b); // first queued one: only the running a is ahead
    await queue.moveDown(d); // last
    await queue.moveUp(a); // running
    await queue.moveDown(a);
    await queue.moveUp(c); // paused
    await queue.moveDown(c);
    expect(ids(queue)).toEqual([a, b, c, d]);
    expect(reorders).toEqual([]);
    await queue.shutdown();
  });

  it('moveUp on an unknown id rejects with "Unknown download"', async () => {
    const { queue } = makeQueue();
    await expect(queue.moveUp('nope')).rejects.toThrow('Unknown download');
    await expect(queue.moveDown('nope')).rejects.toThrow('Unknown download');
    await expect(queue.startNow('nope')).rejects.toThrow('Unknown download');
  });

  it('startNow on a queued item with a free slot starts it first', { timeout: 30_000 }, async () => {
    const { queue, added } = await lineOf(3);
    const [a, b, c] = added as [string, string, string];
    await queue.pause(c);
    await queue.pause(b);
    await queue.pause(a); // nothing queued, so the slot stays free
    expect(queue.hasActive()).toBe(false);
    // Both are queued in memory before either resume reaches schedule(), so the slot is free and b is ahead of c.
    const resumes = [queue.resume(b), queue.resume(c)];
    expect(statusOf(queue, c)).toBe('queued');
    const reorders = recordReorders(queue);
    await queue.startNow(c);
    await Promise.all(resumes);
    expect(statusOf(queue, c)).toBe('downloading');
    expect(statusOf(queue, b)).toBe('queued');
    expect(statusOf(queue, a)).toBe('paused');
    expect(ids(queue)[0]).toBe(c);
    expect(reorders[0]).toEqual([c, a, b]);
    await queue.shutdown();
  });

  it('startNow with the limit full pauses the newest running one, starts the chosen one, and the paused one is queued right behind it', { timeout: 30_000 }, async () => {
    const { queue, added } = await lineOf(3);
    const [a, b, c] = added as [string, string, string];
    let overLimit = false;
    queue.on('changed', () => {
      const running = queue.list().filter((r) => r.status === 'downloading' || r.status === 'waiting').length;
      if (running > 1) overLimit = true;
    });
    await waitFor(() => (queue.list()[0]?.segments[0]?.downloaded ?? 0) > 0);
    const reorders = recordReorders(queue);
    await queue.startNow(c);
    expect(statusOf(queue, c)).toBe('downloading');
    expect(statusOf(queue, a)).toBe('queued');
    expect(ids(queue)).toEqual([c, a, b]);
    expect(reorders).toEqual([[c, a, b]]);
    expect(JSON.parse(await readFile(join(stateDir, 'order.json'), 'utf8'))).toEqual([c, a, b]);
    expect((await loadRecord(join(stateDir, `${a}.json`)))?.status).toBe('queued');
    const savedOffset = queue.list().find((r) => r.id === a)!.segments[0]!.downloaded;
    expect(savedOffset).toBeGreaterThan(0);

    server!.setThrottle(undefined);
    await waitFor(() => [a, b, c].every((id) => statusOf(queue, id) === 'done'), 20_000);
    expect(overLimit).toBe(false);
    expect(server!.requests.some((r) => r.range?.startsWith(`bytes=${savedOffset}-`))).toBe(true);
    for (const i of [0, 1, 2]) expect(await sha256Of(join(saveDir, String(i)))).toBe(server!.sha256);
  });

  it('startNow works on paused and errored items', { timeout: 30_000 }, async () => {
    const { queue, added } = await lineOf(3);
    const [a, b, c] = added as [string, string, string];
    const seen: { id: string; status: string; error: string | undefined }[] = [];
    queue.on('changed', (r: DownloadRecord) => seen.push({ id: r.id, status: r.status, error: r.error }));
    await queue.pause(c);
    await queue.startNow(c);
    expect(statusOf(queue, c)).toBe('downloading');
    expect(statusOf(queue, a)).toBe('queued');
    expect(ids(queue)).toEqual([c, a, b]);

    // c must be streaming already, so the 404 lands on e's probe and not on c's own request.
    await waitFor(() => (queue.list().find((r) => r.id === c)?.segments[0]?.downloaded ?? 0) > 0);
    server!.failNext(404);
    const e = await queue.add(`${server!.url}/file`, join(saveDir, 'e'));
    await queue.startNow(e); // queued: c is paused to make room, then e fails on the 404
    await waitFor(() => statusOf(queue, e) === 'error');
    await waitFor(() => statusOf(queue, c) === 'downloading'); // the freed slot goes to c, right behind e
    expect(seen.some((s) => s.id === e && s.status === 'error' && s.error !== undefined)).toBe(true);
    const mark = seen.length;
    await queue.startNow(e);
    // The error is gone from the record when it goes back in line, before the download starts.
    const requeuedSnapshot = seen.slice(mark).find((s) => s.id === e && s.status === 'queued');
    expect(requeuedSnapshot).toBeDefined();
    expect(requeuedSnapshot?.error).toBeUndefined();
    expect((await loadRecord(join(stateDir, `${e}.json`)))?.error).toBeUndefined();
    expect(statusOf(queue, e)).toBe('downloading');
    expect(queue.list().find((r) => r.id === e)?.error).toBeUndefined();
    expect(statusOf(queue, c)).toBe('queued');
    expect(ids(queue).slice(0, 2)).toEqual([e, c]);
    await queue.shutdown();
  });

  it('startNow never requeues a download that finished before it could be paused', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: MIB, bytesPerSecPerConnection: 4 * MIB });
    const { queue, snapshots } = makeQueue({ maxConcurrent: 1 });
    const a = await queue.add(`${server.url}/file`, join(saveDir, 'a'));
    const b = await queue.add(`${server.url}/file`, join(saveDir, 'b'));
    expect(statusOf(queue, b)).toBe('queued');
    // a reports done while its run is still winding down, so it still holds the slot when startNow picks it.
    const started = new Promise<Promise<void>>((resolve) => {
      queue.on('changed', (r: DownloadRecord) => {
        if (r.id === a && r.status === 'done') resolve(queue.startNow(b));
      });
    });
    await (await started);
    expect(statusOf(queue, a)).toBe('done');
    expect(statusOf(queue, b)).toBe('downloading');
    expect(ids(queue)).toEqual([b, a]);
    await waitFor(() => statusOf(queue, b) === 'done');
    const afterDone = snapshots.slice(snapshots.findIndex((s) => s.id === a && s.status === 'done'));
    expect(afterDone.filter((s) => s.id === a).map((s) => s.status)).toEqual(['done']);
    expect((await loadRecord(join(stateDir, `${a}.json`)))?.status).toBe('done');
    expect(await sha256Of(join(saveDir, 'a'))).toBe(server.sha256);
    expect(await sha256Of(join(saveDir, 'b'))).toBe(server.sha256);
  });

  it('startNow does not interrupt anything when a pause of the chosen item lands while its record is being saved', { timeout: 30_000 }, async () => {
    const { queue, snapshots, added } = await lineOf(2);
    const [a, b] = added as [string, string];
    await queue.pause(b);
    const mark = snapshots.length;
    const starting = queue.startNow(b); // runs up to its record save, with b queued and first in line
    const pausing = queue.pause(b); // lands during that save
    await Promise.all([starting, pausing]);
    expect(statusOf(queue, b)).toBe('paused');
    expect(statusOf(queue, a)).toBe('downloading');
    expect(snapshots.slice(mark).filter((s) => s.id === a)).toEqual([]); // a never changed state
    await queue.shutdown();
  });

  it('startNow with the limit lowered below the running count pauses enough to start the chosen one and requeues them in start order', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const { queue } = makeQueue({ maxConcurrent: 3 });
    const added: string[] = [];
    for (let i = 0; i < 4; i++) added.push(await queue.add(`${server.url}/file`, join(saveDir, String(i))));
    const [a, b, c, d] = added as [string, string, string, string];
    await waitFor(() => [a, b, c].every((id) => (queue.list().find((r) => r.id === id)?.segments[0]?.downloaded ?? 0) > 0));
    expect(statusOf(queue, d)).toBe('queued');
    queue.setMaxConcurrent(1); // stops nothing
    expect([a, b, c].map((id) => statusOf(queue, id))).toEqual(['downloading', 'downloading', 'downloading']);
    await queue.startNow(d);
    expect(statusOf(queue, d)).toBe('downloading');
    expect([a, b, c].map((id) => statusOf(queue, id))).toEqual(['queued', 'queued', 'queued']);
    expect(ids(queue)).toEqual([d, a, b, c]);
    expect(JSON.parse(await readFile(join(stateDir, 'order.json'), 'utf8'))).toEqual([d, a, b, c]);
    expect(queue.list().filter((r) => r.status === 'downloading' || r.status === 'waiting')).toHaveLength(1);

    server.setThrottle(undefined);
    await waitFor(() => added.every((id) => statusOf(queue, id) === 'done'), 20_000);
    for (const i of [0, 1, 2, 3]) expect(await sha256Of(join(saveDir, String(i)))).toBe(server.sha256);
  });

  it('startNow with the limit lowered pauses only the newest running ones and requeues them in start order right behind the chosen one', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 4 * MIB, bytesPerSecPerConnection: MIB });
    const { queue, snapshots } = makeQueue({ maxConcurrent: 3 });
    const added: string[] = [];
    for (let i = 0; i < 6; i++) added.push(await queue.add(`${server.url}/file`, join(saveDir, String(i))));
    const [a, b, c, d, e, f] = added as [string, string, string, string, string, string];
    const streaming = (id: string) => (queue.list().find((r) => r.id === id)?.segments[0]?.downloaded ?? 0) > 0;
    await waitFor(() => [a, b, c].every(streaming));
    // c (the newest) makes room for d, so the line is [d, c, a, b, e, f] but the start order is a, b, d.
    await queue.startNow(d);
    expect(ids(queue)).toEqual([d, c, a, b, e, f]);
    await waitFor(() => [a, b, d].every(streaming));
    queue.setMaxConcurrent(2); // stops nothing
    expect([a, b, d].map((id) => statusOf(queue, id))).toEqual(['downloading', 'downloading', 'downloading']);

    const mark = snapshots.length;
    await queue.startNow(e);
    // Three run, the limit is two: the newest two by start (d, then b) are paused; a, the oldest, keeps running.
    expect(statusOf(queue, e)).toBe('downloading');
    expect(statusOf(queue, a)).toBe('downloading');
    expect(snapshots.slice(mark).filter((s) => s.id === a)).toEqual([]);
    expect([b, d, c, f].map((id) => statusOf(queue, id))).toEqual(['queued', 'queued', 'queued', 'queued']);
    // Behind e come the victims in start order (b before d, though d is ahead of b in line), then the rest as they were.
    expect(ids(queue)).toEqual([e, b, d, c, a, f]);
    expect(JSON.parse(await readFile(join(stateDir, 'order.json'), 'utf8'))).toEqual([e, b, d, c, a, f]);
    expect(queue.list().filter((r) => r.status === 'downloading' || r.status === 'waiting')).toHaveLength(2);

    server.setThrottle(undefined);
    await waitFor(() => added.every((id) => statusOf(queue, id) === 'done'), 20_000);
    for (const i of [0, 1, 2, 3, 4, 5]) expect(await sha256Of(join(saveDir, String(i)))).toBe(server.sha256);
  });

  it('cancel and remove emit reordered with the remaining ids', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: MIB });
    const { queue } = makeQueue({ maxConcurrent: 1 });
    const a = await queue.add(`${server.url}/file`, join(saveDir, 'a'));
    const b = await queue.add(`${server.url}/file`, join(saveDir, 'b'));
    const c = await queue.add(`${server.url}/file`, join(saveDir, 'c'));
    await waitFor(() => [a, b, c].every((id) => statusOf(queue, id) === 'done'));
    const reorders = recordReorders(queue);
    await queue.cancel(b);
    await queue.remove(a);
    expect(reorders).toEqual([[a, c], [c]]);
  });
});

describe('limits', () => {
  const sha256Of = async (dir: string): Promise<string> =>
    createHash('sha256').update(await readFile(join(dir, 'file'))).digest('hex');
  const activeCount = (queue: DownloadQueue) =>
    queue.list().filter((r) => r.status === 'downloading' || r.status === 'waiting').length;
  const throttled = async (size = 4 * MIB) => {
    server = await startFakeServer({ size, bytesPerSecPerConnection: MIB });
    return server;
  };

  it('raising the limit starts waiting items right away', { timeout: 30_000 }, async () => {
    const fake = await throttled();
    const { queue } = makeQueue({ maxConcurrent: 1 });
    const added: string[] = [];
    for (let i = 0; i < 3; i++) added.push(await queue.add(`${fake.url}/file`, join(saveDir, String(i))));
    await waitFor(() => statusOf(queue, added[0]!) === 'downloading');
    expect(queue.list().filter((r) => r.status === 'queued')).toHaveLength(2);
    queue.setMaxConcurrent(3);
    await waitFor(() => added.every((id) => statusOf(queue, id) === 'downloading'));
    fake.setThrottle(undefined);
    await waitFor(() => added.every((id) => statusOf(queue, id) === 'done'), 20_000);
    for (const i of [0, 1, 2]) expect(await sha256Of(join(saveDir, String(i)))).toBe(fake.sha256);
  });

  it('lowering the limit stops nothing and starts nothing until the count is below it', { timeout: 30_000 }, async () => {
    const fake = await throttled();
    const { queue } = makeQueue({ maxConcurrent: 3 });
    const added: string[] = [];
    for (let i = 0; i < 4; i++) added.push(await queue.add(`${fake.url}/file`, join(saveDir, String(i))));
    const [a, b, c, d] = added as [string, string, string, string];
    await waitFor(() => [a, b, c].every((id) => statusOf(queue, id) === 'downloading'));
    queue.setMaxConcurrent(2);
    expect([a, b, c].map((id) => statusOf(queue, id))).toEqual(['downloading', 'downloading', 'downloading']);
    // d must not start while two others are still running.
    let startedWhileFull = false;
    queue.on('changed', (r: DownloadRecord) => {
      if (r.id !== d || r.status !== 'downloading') return;
      const others = queue.list().filter((o) => o.id !== d && (o.status === 'downloading' || o.status === 'waiting')).length;
      if (others >= 2) startedWhileFull = true;
    });
    await queue.pause(a); // 2 left running, the limit is 2
    await waitFor(() => !queue.hasActive() || activeCount(queue) === 2);
    expect(statusOf(queue, d)).toBe('queued');
    await queue.pause(b); // 1 left, below the limit
    await waitFor(() => statusOf(queue, d) === 'downloading');
    expect(startedWhileFull).toBe(false);
    expect(statusOf(queue, c)).toBe('downloading');
    await queue.shutdown();
  });

  it('values are truncated and clamped, NaN is ignored', { timeout: 30_000 }, async () => {
    const fake = await throttled(8 * MIB);
    const settledCount = async (index: number, set: (queue: DownloadQueue) => void, expected: number) => {
      const { queue } = makeQueue({ stateDir: join(root, `state-${index}`), maxConcurrent: 2 });
      set(queue);
      for (let i = 0; i < 8; i++) await queue.add(`${fake.url}/file`, join(saveDir, `${index}-${i}`));
      await waitFor(() => activeCount(queue) === expected);
      expect(queue.list().filter((r) => r.status === 'queued')).toHaveLength(8 - expected);
      await queue.shutdown();
    };
    await settledCount(0, (q) => q.setMaxConcurrent(0), 1);
    await settledCount(1, (q) => q.setMaxConcurrent(99), 6);
    await settledCount(2, (q) => q.setMaxConcurrent(2.9), 2);
    await settledCount(3, (q) => q.setMaxConcurrent(Number.NaN), 2);
  });

  it('segment counts are truncated and clamped, NaN is ignored', { timeout: 30_000 }, async () => {
    const fake = await throttled(8 * MIB);
    const segmentsFor = async (index: number, set: (queue: DownloadQueue) => void): Promise<number> => {
      const { queue } = makeQueue({ stateDir: join(root, `state-${index}`), maxSegments: 3, downloadOptions: { workStealing: false } });
      set(queue);
      const id = await queue.add(`${fake.url}/file`, join(saveDir, String(index)));
      await waitFor(() => (queue.list().find((r) => r.id === id)?.segments.length ?? 0) > 0);
      const count = queue.list().find((r) => r.id === id)?.segments.length ?? 0;
      await queue.shutdown();
      return count;
    };
    expect(await segmentsFor(0, (q) => q.setMaxSegments(0))).toBe(1);
    expect(await segmentsFor(1, (q) => q.setMaxSegments(99))).toBe(8);
    expect(await segmentsFor(2, (q) => q.setMaxSegments(2.9))).toBe(2);
    expect(await segmentsFor(3, (q) => q.setMaxSegments(Number.NaN))).toBe(3);
  });

  it('setMaxSegments applies to downloads added afterwards only', { timeout: 30_000 }, async () => {
    const fake = await throttled();
    const { queue } = makeQueue({ maxSegments: 2, downloadOptions: { workStealing: false } });
    const first = await queue.add(`${fake.url}/file`, join(saveDir, 'first'));
    await waitFor(() => (queue.list().find((r) => r.id === first)?.segments.length ?? 0) > 0);
    queue.setMaxSegments(4);
    const second = await queue.add(`${fake.url}/file`, join(saveDir, 'second'));
    await waitFor(() => (queue.list().find((r) => r.id === second)?.segments.length ?? 0) > 0);
    expect(queue.list().find((r) => r.id === first)?.segments).toHaveLength(2);
    expect(queue.list().find((r) => r.id === second)?.segments).toHaveLength(4);
    await queue.shutdown();
  });
});

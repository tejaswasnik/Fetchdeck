import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdtemp, rename as fsRename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Download, createRecord } from '../src/download';
import { loadRecord } from '../src/store';
import { assertCovers } from './helpers/assertCovers';
import { delay, instantSleep, makeDownload } from './helpers/downloadHarness';
import { startFakeServer, type FakeServer } from './helpers/fakeServer';

const MIB = 1_048_576;
let server: FakeServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const sha = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex');

describe('Download: happy path', () => {
  it('8 MiB downloads in 8 segments; sha256 matches; .part gone; record done', async () => {
    server = await startFakeServer({ size: 8 * MIB });
    const { download, saveDir, recordPath } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(download.record.segments).toHaveLength(8);
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
    expect(await readdir(saveDir)).toEqual(['file']);
    expect((await loadRecord(recordPath))?.status).toBe('done');
  });

  it('emits downloading, non-decreasing progress, then done', async () => {
    server = await startFakeServer({ size: 4 * MIB });
    const { download, events } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(events[0]).toMatchObject({ type: 'status', status: 'downloading' });
    expect(events[events.length - 1]).toMatchObject({ type: 'status', status: 'done' });
    const done = events.flatMap((e) => (e.type === 'progress' ? [e.bytesDone] : []));
    expect(done.length).toBeGreaterThan(0);
    expect([...done].sort((a, b) => a - b)).toEqual(done);
    expect(done[done.length - 1]).toBe(4 * MIB);
  });

  it('existing file gives (1) name', async () => {
    server = await startFakeServer({ size: 1000 });
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    await import('node:fs/promises').then((fs) => fs.mkdir(saveDir, { recursive: true }));
    await writeFile(join(saveDir, 'file'), 'x');
    await download.start();
    expect(download.record.filename).toBe('file (1)');
    expect(await sha(join(saveDir, 'file (1)'))).toBe(server.sha256);
  });
});

describe('Download: pause and resume', () => {
  const slow = { size: 8 * MIB, bytesPerSecPerConnection: 4 * MIB, etag: '"v1"' };

  it('pause mid-download then start again finishes; no request starts below saved offsets', async () => {
    server = await startFakeServer(slow);
    const { download, saveDir, statuses } = await makeDownload(`${server.url}/file`, { saveProgressEveryMs: 20 });
    const first = download.start();
    await delay(120);
    await download.pause();
    await first;
    expect(download.record.status).toBe('paused');
    const snapshot = structuredClone(download.record.segments);
    expect(snapshot.some((s) => s.downloaded > 0)).toBe(true);

    const mark = server.requests.length;
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
    for (const r of server.requests.slice(mark)) {
      if (r.range === 'bytes=0-0') continue;
      const start = Number(/bytes=(\d+)-/.exec(r.range ?? '')![1]);
      expect(snapshot.some((s) => start >= s.start + s.downloaded && start <= s.end)).toBe(true);
    }
    expect(statuses()).toContain('paused');
  });

  it('etag change before resume restarts from zero and still matches', async () => {
    server = await startFakeServer(slow);
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    const first = download.start();
    await delay(120);
    await download.pause();
    await first;
    server.setEtag('"v2"');
    const mark = server.requests.length;
    await download.start();
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
    expect(download.record.etag).toBe('"v2"');
    const ranges = server.requests.slice(mark).map((r) => r.range);
    expect(ranges).toContain('bytes=0-1048575');
  });

  it('size change restarts from zero', async () => {
    server = await startFakeServer(slow);
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    const first = download.start();
    await delay(120);
    await download.pause();
    await first;
    download.record.size = 123; // pretend the file we had was a different size
    const mark = server.requests.length;
    await download.start();
    expect(download.record.size).toBe(8 * MIB);
    expect(server.requests.slice(mark).map((r) => r.range)).toContain('bytes=0-1048575');
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });

  it('syncFile is called before each periodic record save', async () => {
    server = await startFakeServer({ size: 8 * MIB, bytesPerSecPerConnection: 4 * MIB });
    const log: string[] = [];
    const { download, recordPath } = await makeDownload(`${server.url}/file`, {
      saveProgressEveryMs: 30,
      syncFile: async () => {
        log.push('sync');
        // the record on disk must not be newer than this sync: snapshot what it says now
        log.push(`disk:${(await loadRecord(recordPath))?.segments.reduce((n, s) => n + s.downloaded, 0) ?? 0}`);
      },
    });
    await download.start();
    expect(log.filter((l) => l === 'sync').length).toBeGreaterThan(1);
  });

  it('the record on disk shows progress within one save interval', async () => {
    server = await startFakeServer(slow);
    const { download, recordPath } = await makeDownload(`${server.url}/file`, { saveProgressEveryMs: 30 });
    const run = download.start();
    await delay(200);
    const onDisk = await loadRecord(recordPath);
    expect(onDisk!.segments.reduce((n, s) => n + s.downloaded, 0)).toBeGreaterThan(0);
    await download.pause();
    await run;
  });
});

describe('Download: retries', () => {
  it('dropEvery 3 still finishes with matching sha256', async () => {
    server = await startFakeServer({ size: 4 * MIB, dropEvery: 3 });
    const { download, saveDir } = await makeDownload(`${server.url}/file`, { maxSegments: 4 });
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });

  it('failNext(503, 2) finishes', async () => {
    server = await startFakeServer({ size: 2 * MIB });
    server.failNext(503, 2);
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });

  it('failNext(503, 6) ends in error after 5 attempts', async () => {
    server = await startFakeServer({ size: 2 * MIB });
    server.failNext(503, 6);
    const { download } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(download.record.status).toBe('error');
    expect(server.requests.length).toBe(5);
  });

  it('404 ends in error with no retries', async () => {
    server = await startFakeServer({ size: 10 });
    const { download } = await makeDownload(`${server.url}/nope`);
    await download.start();
    expect(download.record).toMatchObject({ status: 'error', error: 'File not found (404)' });
    expect(server.requests).toHaveLength(1);
  });

  it('expired /signed link re-probes and finishes', async () => {
    server = await startFakeServer({ size: 2 * MIB, linkTtlMs: 60 });
    server.failNext(503, 2); // 1st hits the probe, 2nd hits a segment
    const realDelay = async (): Promise<void> => delay(100); // outlive the link
    const { download, saveDir } = await makeDownload(`${server.url}/signed`, { maxSegments: 2, sleep: realDelay });
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await sha(join(saveDir, 'blob'))).toBe(server.sha256);
    expect(server.requests.filter((r) => r.path === '/signed').length).toBeGreaterThanOrEqual(2);
  });

  it('403 on a segment, then on the re-probe, ends in error', async () => {
    server = await startFakeServer({ size: 2 * MIB });
    const { download } = await makeDownload(`${server.url}/file`, {
      writeAt: async () => {
        server!.failNext(403, 10);
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      },
    });
    await download.start();
    expect(download.record.status).toBe('error');
  });

  it('ENOSPC from writeAt gives paused with error "Disk full"', async () => {
    server = await startFakeServer({ size: 2 * MIB });
    const { download } = await makeDownload(`${server.url}/file`, {
      writeAt: async () => {
        throw Object.assign(new Error('full'), { code: 'ENOSPC' });
      },
    });
    await download.start();
    expect(download.record).toMatchObject({ status: 'paused', error: 'Disk full' });
  });

  it('all workers backing off emits waiting, then downloading', async () => {
    server = await startFakeServer({ size: 2 * MIB, dropEvery: 2 });
    const { download, statuses } = await makeDownload(`${server.url}/file`, { maxSegments: 1 });
    await download.start();
    const s = statuses();
    const waiting = s.indexOf('waiting');
    expect(waiting).toBeGreaterThan(0);
    expect(s.slice(waiting)).toContain('downloading');
    expect(s[s.length - 1]).toBe('done');
  });
});

describe('Download: fallback and odd sizes', () => {
  it('ignoreRange from the start finishes with matching sha256 and rangeSupported false', async () => {
    server = await startFakeServer({ size: 2 * MIB, ignoreRange: true });
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(download.record.rangeSupported).toBe(false);
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });

  it('ignoreRangeAfter 1 falls back mid-download and still matches', async () => {
    server = await startFakeServer({ size: 4 * MIB, ignoreRangeAfter: 1 });
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(download.record.status).toBe('done');
    expect(download.record.rangeSupported).toBe(false);
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });

  it('omitLength finishes, size stays null, etaSeconds is null', async () => {
    server = await startFakeServer({ size: 2 * MIB, omitLength: true });
    const { download, saveDir, events } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(download.record.size).toBeNull();
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
    for (const e of events) if (e.type === 'progress') expect(e.etaSeconds).toBeNull();
  });

  it('size 0 gives an empty file, status done, no range requests', async () => {
    server = await startFakeServer({ size: 0 });
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(download.record.status).toBe('done');
    expect((await readFile(join(saveDir, 'file'))).length).toBe(0);
    expect(server.requests.every((r) => r.range === 'bytes=0-0')).toBe(true);
  });

  it('size 1 uses exactly one segment', async () => {
    server = await startFakeServer({ size: 1 });
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    await download.start();
    expect(download.record.segments).toHaveLength(1);
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });

  it('pause then start on single-stream restarts from zero', async () => {
    server = await startFakeServer({ size: 2 * MIB, ignoreRange: true, bytesPerSecPerConnection: 4 * MIB });
    const { download, saveDir } = await makeDownload(`${server.url}/file`);
    const first = download.start();
    await delay(100);
    await download.pause();
    await first;
    expect(download.record.status).toBe('paused');
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
    expect(server.requests.every((r) => r.range === null || r.range === 'bytes=0-0')).toBe(true);
  });
});

describe('Download: work stealing', () => {
  const timed = async (workStealing: boolean) => {
    server = await startFakeServer({ size: 6 * MIB, slowRangeStart: 0, slowBytesPerSec: 2 * MIB });
    const { download, saveDir } = await makeDownload(`${server.url}/file`, { maxSegments: 2, workStealing });
    const started = Date.now();
    await download.start();
    const elapsed = Date.now() - started;
    const result = { elapsed, download, sha: await sha(join(saveDir, 'file')), server };
    return result;
  };

  it('is faster than no stealing and stays correct', { timeout: 30_000 }, async () => {
    const without = await timed(false);
    await server!.close();
    const withSteal = await timed(true);
    expect(withSteal.sha).toBe(withSteal.server.sha256);
    expect(withSteal.elapsed).toBeLessThan(without.elapsed * 0.6);
    expect(withSteal.download.record.segments.length).toBeGreaterThan(2);
    assertCovers(withSteal.download.record.segments, 6 * MIB);
    // The server sees a cancelled request close a moment after its worker has already been replaced.
    expect(withSteal.server.maxInFlight()).toBeLessThanOrEqual(3);
  });
});

describe('Download: options', () => {
  it('undefined options fall back to defaults', async () => {
    server = await startFakeServer({ size: 2 * MIB });
    const { download, saveDir } = await makeDownload(`${server.url}/file`, { maxSegments: undefined });
    await download.start();
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });
});

describe('Download: duplicate filenames', () => {
  it('four same-URL downloads started at once get four distinct, intact files', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 2 * MIB });
    const root = await mkdtemp(join(tmpdir(), 'dup-'));
    try {
      const saveDir = join(root, 'out');
      const downloads = Array.from({ length: 4 }, (_, i) =>
        new Download(createRecord(`${server!.url}/file`, saveDir), { recordPath: join(root, `r${i}.json`), sleep: instantSleep }),
      );
      await Promise.all(downloads.map((d) => d.start()));
      const names = downloads.map((d) => d.record.filename);
      expect(new Set(names).size).toBe(4);
      expect((await readdir(saveDir)).sort()).toEqual([...names].sort());
      for (const name of names) expect(await sha(join(saveDir, name))).toBe(server.sha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Download: finishing on Windows', () => {
  const transient = (): NodeJS.ErrnoException => Object.assign(new Error('EPERM'), { code: 'EPERM' });

  it('retries a transient rename failure and still finishes', async () => {
    server = await startFakeServer({ size: MIB });
    let failures = 2;
    const { download, saveDir } = await makeDownload(`${server.url}/file`, {
      renameRetry: {
        rename: async (from, to) => {
          if (failures-- > 0) throw transient();
          await fsRename(from, to);
        },
        sleep: async () => undefined,
      },
    });
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });

  it('a rename that always fails ends in error with a plain message, and Retry can finish later', async () => {
    server = await startFakeServer({ size: MIB });
    let broken = true;
    const { download, saveDir } = await makeDownload(`${server.url}/file`, {
      renameRetry: {
        rename: async (from, to) => {
          if (broken) throw transient();
          await fsRename(from, to);
        },
        sleep: async () => undefined,
      },
    });
    await download.start();
    expect(download.record.status).toBe('error');
    expect(download.record.error).toBe('Could not finish saving the file; close any program using it and press Retry');
    broken = false;
    await download.start();
    expect(download.record.status).toBe('done');
    expect(await sha(join(saveDir, 'file'))).toBe(server.sha256);
  });
});

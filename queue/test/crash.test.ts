import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from '../../engine/test/helpers/fakeServer';
import { DownloadQueue } from '../src/queue';

const root = resolve(import.meta.dirname, '../..');
let server: FakeServer | undefined;
let dir: string | undefined;

afterEach(async () => {
  await server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('crash recovery', () => {
  it('SIGKILL mid-download then resume gives a byte-identical file', { timeout: 60_000 }, async () => {
    server = await startFakeServer({ size: 16 * 1_048_576, bytesPerSecPerConnection: 1_048_576 });
    dir = await mkdtemp(join(tmpdir(), 'crash-'));
    const stateDir = join(dir, 'state');
    const saveDir = join(dir, 'out');

    const child = fork(join(root, 'queue/test/helpers/crashChild.ts'), [`${server.url}/file`, saveDir, stateDir], {
      execArgv: ['--import', 'tsx'],
      cwd: root,
    });
    await new Promise<void>((resolveReady, reject) => {
      child.once('message', (m) => (m === 'ready' ? resolveReady() : reject(new Error(`unexpected ${String(m)}`))));
      child.once('exit', () => reject(new Error('child exited early')));
    });
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;

    server.setThrottle(undefined);
    const queue = new DownloadQueue({ stateDir });
    await queue.load();
    const [record] = queue.list();
    expect(record?.status).toBe('paused');
    await queue.resume(record!.id);
    await new Promise<void>((resolveDone, reject) => {
      const check = (): void => {
        const status = queue.list()[0]?.status;
        if (status === 'done') resolveDone();
        else if (status === 'error') reject(new Error(queue.list()[0]?.error));
      };
      queue.on('changed', check);
      check();
    });

    const file = await readFile(join(saveDir, 'file'));
    expect(createHash('sha256').update(file).digest('hex')).toBe(server.sha256);
  });
});

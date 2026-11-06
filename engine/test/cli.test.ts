import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startFakeServer, type FakeServer } from './helpers/fakeServer';

const root = resolve(import.meta.dirname, '../..');
let server: FakeServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close();
  server = undefined;
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const runCli = async (args: string[]) => {
  const dir = await mkdtemp(join(tmpdir(), 'cli-'));
  dirs.push(dir);
  return new Promise<{ code: number | null; stdout: string; stderr: string; dir: string }>((done) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'engine/cli/dl.ts', ...args, '--dir', dir], {
      cwd: root,
      env: { ...process.env, FETCHDECK_STATE_DIR: join(dir, '.state') },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => done({ code, stdout, stderr, dir }));
  });
};

describe('dl CLI', () => {
  it('exits 0 and file sha256 matches', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 2 * 1_048_576 });
    const r = await runCli([`${server.url}/file`]);
    expect(r.code).toBe(0);
    const file = await readFile(join(r.dir, 'file'));
    expect(createHash('sha256').update(file).digest('hex')).toBe(server.sha256);
  });

  it('exits 1 for ftp://x with a plain message', { timeout: 30_000 }, async () => {
    const r = await runCli(['ftp://x']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('http');
  });

  it('exits 1 for a 404', { timeout: 30_000 }, async () => {
    server = await startFakeServer({ size: 10 });
    const r = await runCli([`${server.url}/nope`]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('File not found (404)');
  });
});

import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Download, InvalidUrlError, assertHttpUrl, createRecord, loadRecord, type EngineEvent } from '../src/index';

const formatBytes = (n: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
};

const formatEta = (seconds: number | null): string => {
  if (seconds === null) return '--';
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { dir: { type: 'string' }, segments: { type: 'string' } },
  });
  const url = positionals[0];
  if (!url) return fail('Usage: dl <url> [--dir <folder>] [--segments <n>]');

  try {
    assertHttpUrl(url);
  } catch (err) {
    return fail(err instanceof InvalidUrlError ? err.message : String(err));
  }

  const saveDir = resolve(values.dir ?? '.');
  const maxSegments = values.segments ? Number(values.segments) : undefined;
  if (maxSegments !== undefined && (!Number.isInteger(maxSegments) || maxSegments < 1)) {
    return fail('--segments must be a positive whole number');
  }

  // The same url + folder always maps to the same record, so re-running resumes a paused download.
  const stateDir = process.env.FETCHDECK_STATE_DIR ?? join(tmpdir(), 'fetchdeck-cli');
  await mkdir(stateDir, { recursive: true });
  const id = createHash('sha256').update(`${url}\n${saveDir}`).digest('hex').slice(0, 16);
  const recordPath = join(stateDir, `${id}.json`);
  const existing = await loadRecord(recordPath).catch(() => null);
  const record = existing && existing.status !== 'done' ? existing : createRecord(url, saveDir, id);

  const download = new Download(record, { recordPath, maxSegments });
  let lastLine = '';
  download.on('event', (e: EngineEvent) => {
    if (e.type === 'progress') {
      const size = download.record.size;
      const percent = size ? `${Math.floor((e.bytesDone / size) * 100)}%` : formatBytes(e.bytesDone);
      lastLine = `\r${percent}  ${formatBytes(e.speed)}/s  ETA ${formatEta(e.etaSeconds)}   `;
      process.stdout.write(lastLine);
    } else if (e.type === 'status' && e.status === 'waiting') {
      process.stdout.write('\rWaiting for the network...                    ');
    }
  });

  process.on('SIGINT', () => {
    void download.pause().then(() => {
      process.stdout.write('\nPaused. Run the same command again to resume.\n');
      process.exit(130);
    });
  });

  await download.start();
  if (lastLine) process.stdout.write('\n');

  const { status, error, filename } = download.record;
  if (status === 'done') {
    process.stdout.write(`Saved ${join(saveDir, filename)}\n`);
  } else {
    fail(error ?? `Download ended with status ${status}`);
  }
};

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));

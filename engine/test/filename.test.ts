import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseFilename, sanitizeFilename, uniqueName } from '../src/filename';

describe('sanitizeFilename', () => {
  it('strips path traversal', () => expect(sanitizeFilename('../../evil.exe')).toBe('evil.exe'));
  it('strips windows paths', () => expect(sanitizeFilename('C:\\temp\\a.zip')).toBe('a.zip'));
  it('replaces illegal chars', () => expect(sanitizeFilename('a:b*c?.zip')).toBe('a_b_c_.zip'));
  it('prefixes reserved names', () => expect(sanitizeFilename('CON.txt')).toBe('_CON.txt'));
});

describe('chooseFilename', () => {
  const u = 'http://h/dir/file.bin';
  it('decodes filename*', () =>
    expect(chooseFilename("attachment; filename*=UTF-8''%E2%82%AC%20rates.txt", u, u)).toBe('€ rates.txt'));
  it('filename* wins over filename', () =>
    expect(chooseFilename("attachment; filename=\"a.txt\"; filename*=UTF-8''b.txt", u, u)).toBe('b.txt'));
  it('plain filename', () => expect(chooseFilename('attachment; filename="a.txt"', u, u)).toBe('a.txt'));
  it('no header uses the final URL', () => expect(chooseFilename(null, u, 'http://h/orig.bin')).toBe('file.bin'));
  it('empty final path falls back to the original URL', () =>
    expect(chooseFilename(null, 'http://h/dir/', 'http://h/orig.bin')).toBe('orig.bin'));
  it('nothing usable gives download', () => expect(chooseFilename(null, 'http://h/', 'http://h/')).toBe('download'));
});

describe('uniqueName', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'uniq-')); });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('gives a (1).zip then a (2).zip', async () => {
    expect(await uniqueName(dir, 'a.zip')).toBe('a.zip');
    await writeFile(join(dir, 'a.zip'), '');
    expect(await uniqueName(dir, 'a.zip')).toBe('a (1).zip');
    await writeFile(join(dir, 'a (1).zip'), '');
    expect(await uniqueName(dir, 'a.zip')).toBe('a (2).zip');
  });

  it('a.zip.part counts as taken', async () => {
    await writeFile(join(dir, 'a.zip.part'), '');
    expect(await uniqueName(dir, 'a.zip')).toBe('a (1).zip');
  });
});

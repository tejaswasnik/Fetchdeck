import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CorruptRecordError } from '@fetchdeck/engine';
import { loadOrder, saveOrder } from '../src/orderStore';

let root: string;
let path: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'order-'));
  path = join(root, 'order.json');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('orderStore', () => {
  it('save then load returns the same ids', async () => {
    await saveOrder(path, ['c', 'a', 'b']);
    expect(await loadOrder(path)).toEqual(['c', 'a', 'b']);
  });

  it('missing file loads as null', async () => {
    expect(await loadOrder(path)).toBeNull();
  });

  it('invalid JSON throws CorruptRecordError', async () => {
    await writeFile(path, '{oops');
    await expect(loadOrder(path)).rejects.toBeInstanceOf(CorruptRecordError);
  });

  it('an array with a non-string throws CorruptRecordError', async () => {
    await writeFile(path, JSON.stringify(['a', 2]));
    await expect(loadOrder(path)).rejects.toBeInstanceOf(CorruptRecordError);
  });

  it('50 concurrent saves leave a parseable file and no .tmp', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => saveOrder(path, [String(i)])));
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(['49']);
    expect(await readdir(root)).toEqual(['order.json']);
  });
});

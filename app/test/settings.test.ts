import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asSettingsPatch } from '../main/validate';
import { createSettingsStore } from '../main/settings';

let dir: string;
let defaultSaveDir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fetchdeck-settings-'));
  defaultSaveDir = join(dir, 'downloads');
  await mkdir(defaultSaveDir);
  path = join(dir, 'settings.json');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const make = () => createSettingsStore({ path, defaultSaveDir });

describe('settings store', () => {
  it('a missing file loads defaults: default folder, 3, 8, notifications on', async () => {
    expect(await make().load()).toEqual({ saveDir: defaultSaveDir, maxConcurrent: 3, maxSegments: 8, notifications: true });
  });

  it('a corrupt file loads defaults', async () => {
    await writeFile(path, '{not json');
    const store = make();
    expect(await store.load()).toEqual({ saveDir: defaultSaveDir, maxConcurrent: 3, maxSegments: 8, notifications: true });
    expect(store.get().maxConcurrent).toBe(3);
  });

  it('each invalid field falls back to its own default and valid fields are kept', async () => {
    const mine = join(dir, 'mine');
    await writeFile(path, JSON.stringify({ saveDir: mine, maxConcurrent: 99, maxSegments: 5, notifications: 'yes' }));
    expect(await make().load()).toEqual({ saveDir: mine, maxConcurrent: 3, maxSegments: 5, notifications: true });
  });

  it('a saved folder that no longer exists and cannot be created falls back to the default folder', async () => {
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'x');
    await writeFile(path, JSON.stringify({ saveDir: join(blocker, 'sub'), maxConcurrent: 2 }));
    expect(await make().load()).toEqual({ saveDir: defaultSaveDir, maxConcurrent: 2, maxSegments: 8, notifications: true });
  });

  it('update saves, and a new store reads the same values back; no .tmp remains', async () => {
    const store = make();
    await store.load();
    const next = await store.update({ maxConcurrent: 5, notifications: false });
    expect(next).toEqual({ saveDir: defaultSaveDir, maxConcurrent: 5, maxSegments: 8, notifications: false });
    expect(store.get()).toEqual(next);
    expect(await make().load()).toEqual(next);
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('update keeps the old settings in memory when the save fails', async () => {
    const store = createSettingsStore({ path: join(dir, 'missing-dir', 'settings.json'), defaultSaveDir });
    await store.load();
    await expect(store.update({ maxConcurrent: 6 })).rejects.toThrow();
    expect(store.get().maxConcurrent).toBe(3);
  });

  it('setSaveDir saves an existing folder', async () => {
    const store = make();
    await store.load();
    const other = join(dir, 'other');
    await mkdir(other);
    expect((await store.setSaveDir(other)).saveDir).toBe(other);
    expect(JSON.parse(await readFile(path, 'utf8')).saveDir).toBe(other);
  });

  it('setSaveDir rejects a missing folder and a file path, and keeps the old folder', async () => {
    const store = make();
    await store.load();
    const file = join(dir, 'a-file');
    await writeFile(file, 'x');
    await expect(store.setSaveDir(join(dir, 'nope'))).rejects.toThrow(/folder/i);
    await expect(store.setSaveDir(file)).rejects.toThrow(/folder/i);
    await expect(store.setSaveDir(join(file, 'sub'))).rejects.toThrow(/folder/i);
    expect(store.get().saveDir).toBe(defaultSaveDir);
  });
});

describe('asSettingsPatch', () => {
  it.each([NaN, 2.5, '3', 0, 7, null, [], { x: 1 }, Infinity])('rejects maxConcurrent %j', (value) => {
    expect(() => asSettingsPatch({ maxConcurrent: value })).toThrow('Simultaneous downloads must be a whole number from 1 to 6.');
  });

  it.each([NaN, 2.5, '3', 0, 9, null, [], { x: 1 }, Infinity])('rejects maxSegments %j', (value) => {
    expect(() => asSettingsPatch({ maxSegments: value })).toThrow('Connections per download must be a whole number from 1 to 8.');
  });

  it.each(['true', 1, null, undefined])('rejects notifications %j', (value) => {
    expect(() => asSettingsPatch({ notifications: value })).toThrow('Notifications must be on or off.');
  });

  it.each([null, undefined, [], 'x', 3])('rejects a non-object patch %j', (value) => {
    expect(() => asSettingsPatch(value)).toThrow('Settings must be an object.');
  });

  it('rejects saveDir and unknown keys', () => {
    expect(() => asSettingsPatch({ saveDir: '/tmp' })).toThrow('Unknown setting: saveDir.');
    expect(() => asSettingsPatch({ maxConcurrent: 2, extra: 1 })).toThrow('Unknown setting: extra.');
  });

  it('accepts a partial patch', () => {
    expect(asSettingsPatch({})).toEqual({});
    expect(asSettingsPatch({ maxConcurrent: 6 })).toEqual({ maxConcurrent: 6 });
    expect(asSettingsPatch({ maxSegments: 1, notifications: false })).toEqual({ maxSegments: 1, notifications: false });
  });
});

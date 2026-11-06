import { constants } from 'node:fs';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { writeFileAtomic } from '@fetchdeck/engine';
import { SETTINGS_LIMITS, type Settings, type SettingsPatch } from '../shared/api';

export type SettingsStore = {
  load(): Promise<Settings>;
  get(): Settings;
  update(patch: SettingsPatch): Promise<Settings>;
  /** Throws a plain Error if the folder is missing or not writable; the old folder is kept. */
  setSaveDir(dir: string): Promise<Settings>;
};

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_SEGMENTS = 8;

const wholeNumberIn = (value: unknown, limits: { min: number; max: number }, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= limits.min && value <= limits.max ? value : fallback;

const isWritableFolder = async (dir: string): Promise<boolean> => {
  try {
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const readSaved = async (path: string): Promise<Record<string, unknown>> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
  } catch {
    return {}; // a missing or corrupt file never blocks startup
  }
};

// A saved folder that was deleted or sits on an unplugged drive falls back to the default instead of failing every new download.
const usableSaveDir = async (saved: unknown, defaultSaveDir: string): Promise<string> => {
  if (typeof saved !== 'string' || saved === '') return defaultSaveDir;
  try {
    await mkdir(saved, { recursive: true });
  } catch {
    return defaultSaveDir;
  }
  return (await isWritableFolder(saved)) ? saved : defaultSaveDir;
};

export const createSettingsStore = (options: { path: string; defaultSaveDir: string }): SettingsStore => {
  const { path, defaultSaveDir } = options;
  let current: Settings = {
    saveDir: defaultSaveDir,
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    maxSegments: DEFAULT_MAX_SEGMENTS,
    notifications: true,
  };

  // Save first, then swap, so a failed save leaves the settings in memory unchanged.
  const commit = async (next: Settings): Promise<Settings> => {
    await writeFileAtomic(path, JSON.stringify(next, null, 2));
    current = next;
    return next;
  };

  return {
    async load() {
      const saved = await readSaved(path);
      current = {
        saveDir: await usableSaveDir(saved.saveDir, defaultSaveDir),
        maxConcurrent: wholeNumberIn(saved.maxConcurrent, SETTINGS_LIMITS.maxConcurrent, DEFAULT_MAX_CONCURRENT),
        maxSegments: wholeNumberIn(saved.maxSegments, SETTINGS_LIMITS.maxSegments, DEFAULT_MAX_SEGMENTS),
        notifications: typeof saved.notifications === 'boolean' ? saved.notifications : true,
      };
      return current;
    },
    get: () => current,
    update: (patch) => commit({ ...current, ...patch }),
    async setSaveDir(dir) {
      let isFolder = false;
      try {
        isFolder = (await stat(dir)).isDirectory();
      } catch {
        isFolder = false;
      }
      if (!isFolder) throw new Error('That folder does not exist.');
      if (!(await isWritableFolder(dir))) throw new Error('Fetchdeck cannot save files to that folder.');
      return commit({ ...current, saveDir: dir });
    },
  };
};

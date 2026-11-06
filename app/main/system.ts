import { assertHttpUrl, planSegments, probe, uniqueName } from '@fetchdeck/engine';
import { dialog, shell } from 'electron';
import { rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { SystemLike } from './ipc';

export const createSystem = (): SystemLike => ({
  async preview(url, saveDir) {
    assertHttpUrl(url);
    const result = await probe(url);
    const filename = await uniqueName(saveDir, result.filename);
    return {
      filename,
      size: result.size,
      rangeSupported: result.rangeSupported,
      host: new URL(result.finalUrl).hostname,
      connections: result.rangeSupported && result.size ? Math.max(1, planSegments(result.size).length) : 1,
      saveTo: join(saveDir, filename),
    };
  },
  async openPath(path) {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  },
  showItemInFolder: (path) => shell.showItemInFolder(path),
  async freeBytes(dir) {
    try {
      const stats = await statfs(dir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  },
  deleteFile: (path) => rm(path, { force: true }),
  async chooseFolder(current) {
    const result = await dialog.showOpenDialog({ defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
});

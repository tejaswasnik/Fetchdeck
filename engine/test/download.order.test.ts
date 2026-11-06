import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        calls.push('close');
        return close();
      };
      return handle;
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      calls.push('rename');
      return fs.rename(...args);
    },
  };
});

import { makeDownload } from './helpers/downloadHarness';
import { startFakeServer, type FakeServer } from './helpers/fakeServer';

let server: FakeServer | undefined;
afterEach(async () => {
  await server?.close();
});

describe('Download ordering', () => {
  it('file handle is closed before rename', async () => {
    server = await startFakeServer({ size: 1_048_576 });
    const { download } = await makeDownload(`${server.url}/file`);
    await download.start();
    const finalRename = calls.lastIndexOf('rename');
    expect(finalRename).toBeGreaterThan(0);
    expect(calls.slice(0, finalRename)).toContain('close');
    expect(calls.lastIndexOf('close')).toBeLessThan(finalRename);
  });
});

import { describe, expect, it } from 'vitest';
import { renameWithRetry } from '../src/renameRetry';

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });
const noSleep = async (): Promise<void> => undefined;

describe('renameWithRetry', () => {
  it('retries a transient failure and then succeeds', async () => {
    let calls = 0;
    const slept: number[] = [];
    await renameWithRetry('a', 'b', {
      rename: async () => {
        if (++calls <= 2) throw errno('EPERM');
      },
      sleep: async (ms) => void slept.push(ms),
    });
    expect(calls).toBe(3);
    expect(slept).toEqual([50, 100]);
  });

  it('gives up after 5 retries and throws the last error', async () => {
    let calls = 0;
    await expect(
      renameWithRetry('a', 'b', {
        rename: async () => {
          calls++;
          throw errno('EBUSY');
        },
        sleep: noSleep,
      }),
    ).rejects.toThrow('EBUSY');
    expect(calls).toBe(6);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(
      renameWithRetry('a', 'b', {
        rename: async () => {
          calls++;
          throw errno('ENOENT');
        },
        sleep: noSleep,
      }),
    ).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });
});

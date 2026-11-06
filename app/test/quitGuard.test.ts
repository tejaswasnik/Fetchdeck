import { describe, expect, it, vi } from 'vitest';
import { createQuitGate, shouldCloseWindow } from '../main/quitGuard';

describe('shouldCloseWindow', () => {
  it('closes without asking when nothing is downloading', async () => {
    const confirmQuit = vi.fn(async () => false);
    expect(await shouldCloseWindow({ hasActiveDownloads: () => false, confirmQuit })).toBe(true);
    expect(confirmQuit).not.toHaveBeenCalled();
  });

  it('asks when downloads are active and follows the answer', async () => {
    expect(await shouldCloseWindow({ hasActiveDownloads: () => true, confirmQuit: async () => true })).toBe(true);
    expect(await shouldCloseWindow({ hasActiveDownloads: () => true, confirmQuit: async () => false })).toBe(false);
  });
});

describe('createQuitGate', () => {
  it('lets only the first before-quit through', () => {
    const gate = createQuitGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
  });
});

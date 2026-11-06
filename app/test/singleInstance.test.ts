import { describe, expect, it, vi } from 'vitest';
import { revealWindow, shouldQuitAsDuplicate } from '../main/singleInstance';

describe('shouldQuitAsDuplicate', () => {
  it('quits only when the lock was not obtained', () => {
    expect(shouldQuitAsDuplicate(false)).toBe(true);
    expect(shouldQuitAsDuplicate(true)).toBe(false);
  });
});

describe('revealWindow', () => {
  it('restores a minimized window, then focuses it', () => {
    const calls: string[] = [];
    revealWindow({ isMinimized: () => true, restore: () => calls.push('restore'), focus: () => calls.push('focus') });
    expect(calls).toEqual(['restore', 'focus']);
  });

  it('only focuses a window that is not minimized', () => {
    const restore = vi.fn();
    const focus = vi.fn();
    revealWindow({ isMinimized: () => false, restore, focus });
    expect(restore).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('does nothing when there is no window yet', () => {
    expect(() => revealWindow(null)).not.toThrow();
  });
});

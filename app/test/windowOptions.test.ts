import { describe, expect, it } from 'vitest';
import { createWindowOptions } from '../main/windowOptions';

describe('createWindowOptions', () => {
  it('has contextIsolation true, nodeIntegration false, sandbox true and the preload path', () => {
    const prefs = createWindowOptions('/p/preload.cjs').webPreferences!;
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.preload).toBe('/p/preload.cjs');
  });

  it('is frameless because the page draws its own title bar', () => {
    expect(createWindowOptions('/p/preload.cjs').frame).toBe(false);
  });
});

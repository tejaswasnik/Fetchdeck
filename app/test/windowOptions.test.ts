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

  it('keeps the default and minimum size when the screen is large enough', () => {
    const options = createWindowOptions('/p/preload.cjs', undefined, { width: 1920, height: 1040 });
    expect([options.width, options.height, options.minWidth, options.minHeight]).toEqual([1280, 800, 960, 600]);
  });

  it('never opens larger than the usable screen area, so the bottom of the window stays on screen', () => {
    const options = createWindowOptions('/p/preload.cjs', undefined, { width: 1366, height: 728 });
    expect(options.width).toBe(1280);
    expect(options.height).toBe(728);
    expect(options.minHeight).toBe(600);
    const tiny = createWindowOptions('/p/preload.cjs', undefined, { width: 900, height: 500 });
    expect([tiny.width, tiny.height, tiny.minWidth, tiny.minHeight]).toEqual([900, 500, 900, 500]);
  });
});

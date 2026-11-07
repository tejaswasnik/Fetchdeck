import { describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from '../src/settings';
import { DEFAULT_THRESHOLD_BYTES } from '../src/shouldCapture';

const storage = (initial: Record<string, unknown> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => data.has(k)).map((k) => [k, data.get(k)]))),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.entries(items).forEach(([k, v]) => data.set(k, v)); }),
    remove: vi.fn(),
  };
};

describe('extension settings', () => {
  it('start on, with the 5 MB threshold and no token', async () => {
    expect(await loadSettings(storage())).toEqual({ enabled: true, thresholdBytes: DEFAULT_THRESHOLD_BYTES, token: '' });
  });

  it('reads what was saved', async () => {
    const saved = storage({ enabled: false, thresholdBytes: 1048576, token: 'abc' });
    expect(await loadSettings(saved)).toEqual({ enabled: false, thresholdBytes: 1048576, token: 'abc' });
  });

  it.each([
    ['text for the switch', { enabled: 'yes' }],
    ['a negative threshold', { thresholdBytes: -5 }],
    ['a zero threshold', { thresholdBytes: 0 }],
    ['a threshold that is not a number', { thresholdBytes: 'big' }],
    ['an infinite threshold', { thresholdBytes: Infinity }],
    ['a token that is not text', { token: 42 }],
  ])('falls back to the default for %s', async (_name, bad) => {
    expect(await loadSettings(storage(bad))).toEqual({ enabled: true, thresholdBytes: DEFAULT_THRESHOLD_BYTES, token: '' });
  });

  it('saves only what changed and keeps the rest', async () => {
    const s = storage({ enabled: true, thresholdBytes: 1048576, token: 'abc' });
    await saveSettings(s, { enabled: false });
    expect(s.set).toHaveBeenCalledWith({ enabled: false });
    expect(await loadSettings(s)).toEqual({ enabled: false, thresholdBytes: 1048576, token: 'abc' });
  });
});

describe('the options form fields', () => {
  it('reads the threshold in megabytes, and refuses sizes it cannot use', async () => {
    const { parseThresholdMb } = await import('../src/settings');
    expect(parseThresholdMb('5')).toBe(5 * 1024 * 1024);
    expect(parseThresholdMb(' 1 ')).toBe(1024 * 1024);
    expect(parseThresholdMb('2.5')).toBe(Math.round(2.5 * 1024 * 1024));
    for (const bad of ['', '  ', '0', '0.5', '-3', 'big', 'Infinity', '1e9']) expect(parseThresholdMb(bad)).toBeNull();
  });

  it('trims a pasted token, allows an empty one, and refuses anything with spaces or symbols inside', async () => {
    const { parseToken } = await import('../src/settings');
    expect(parseToken('  abc_DEF-123\n')).toBe('abc_DEF-123');
    expect(parseToken('')).toBe('');
    for (const bad of ['abc def', 'abc\ndef', 'Bearer abc', 'abc=', 'tok€n']) expect(parseToken(bad)).toBeNull();
  });
});

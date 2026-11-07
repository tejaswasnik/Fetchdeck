import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLD_BYTES, shouldCapture, type DownloadItemLike } from '../src/shouldCapture';

const MB = 1024 * 1024;
const item = (patch: Partial<DownloadItemLike> = {}): DownloadItemLike => ({
  id: 1, url: 'https://x.example/f.zip', referrer: '', filename: '', totalBytes: 6 * MB, state: 'in_progress', ...patch,
});
const on = { enabled: true, thresholdBytes: DEFAULT_THRESHOLD_BYTES };

describe('shouldCapture', () => {
  it('the default threshold is 5 MB', () => {
    expect(DEFAULT_THRESHOLD_BYTES).toBe(5 * MB);
  });

  it('captures a big http or https download that is still in progress', () => {
    expect(shouldCapture(item(), on)).toBe(true);
    expect(shouldCapture(item({ url: 'http://x.example/f.zip' }), on)).toBe(true);
    expect(shouldCapture(item({ totalBytes: 5 * MB }), on)).toBe(true);
  });

  it.each([
    ['under the threshold', { totalBytes: 4 * MB }],
    ['one byte under the threshold', { totalBytes: 5 * MB - 1 }],
    ['an unknown size', { totalBytes: -1 }],
    ['an empty file', { totalBytes: 0 }],
    ['a blob: url', { url: 'blob:https://x.example/6f1b-uuid' }],
    ['a data: url', { url: 'data:application/zip;base64,AAAA' }],
    ['an ftp: url', { url: 'ftp://x.example/f.zip' }],
    ['a file: url', { url: 'file:///C:/f.zip' }],
    ['a url that is not a url', { url: 'not a url' }],
    ['a download that already completed', { state: 'complete' as const }],
    ['a download that was interrupted', { state: 'interrupted' as const }],
  ])('leaves %s to the browser', (_name, patch) => {
    expect(shouldCapture(item(patch), on)).toBe(false);
  });

  it('leaves everything to the browser when capturing is off', () => {
    expect(shouldCapture(item(), { enabled: false, thresholdBytes: DEFAULT_THRESHOLD_BYTES })).toBe(false);
  });

  it('a lowered threshold captures a 1 MB download, a raised one skips a 6 MB download', () => {
    expect(shouldCapture(item({ totalBytes: 1 * MB }), { enabled: true, thresholdBytes: 1 * MB })).toBe(true);
    expect(shouldCapture(item(), { enabled: true, thresholdBytes: 10 * MB })).toBe(false);
  });
});

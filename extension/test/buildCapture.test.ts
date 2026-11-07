import { describe, expect, it, vi } from 'vitest';
import { buildCapture } from '../src/buildCapture';
import type { DownloadItemLike } from '../src/shouldCapture';

const item = (patch: Partial<DownloadItemLike> = {}): DownloadItemLike => ({
  id: 1, url: 'https://site.example/files/big.zip', referrer: 'https://site.example/page', filename: '', totalBytes: 6_000_000, state: 'in_progress', ...patch,
});
const deps = (cookies: { name: string; value: string }[] = []) => ({ getCookies: vi.fn().mockResolvedValue(cookies), userAgent: 'Mozilla/5.0 Test' });

describe('buildCapture', () => {
  it('joins the cookies the browser would send as name=value pairs, and passes the referrer, size and user agent', async () => {
    const d = deps([{ name: 'sid', value: 'abc' }, { name: 'theme', value: 'dark' }]);
    const payload = await buildCapture(d, item());
    expect(d.getCookies).toHaveBeenCalledWith('https://site.example/files/big.zip');
    expect(payload).toEqual({
      url: 'https://site.example/files/big.zip',
      cookie: 'sid=abc; theme=dark',
      referer: 'https://site.example/page',
      userAgent: 'Mozilla/5.0 Test',
      size: 6_000_000,
    });
  });

  it('leaves out the cookie key when there are no cookies, the referer when there is none, and the size when unknown', async () => {
    const payload = await buildCapture(deps(), item({ referrer: '', totalBytes: -1 }));
    expect(payload).toEqual({ url: 'https://site.example/files/big.zip', userAgent: 'Mozilla/5.0 Test' });
    expect('cookie' in payload).toBe(false);
    expect('referer' in payload).toBe(false);
    expect('size' in payload).toBe(false);
  });

  it.each([
    ['a Windows path', 'C:\\Users\\tejas\\Downloads\\big.zip', 'big.zip'],
    ['a Unix path', '/home/tejas/Downloads/big.zip', 'big.zip'],
    ['a bare name', 'big.zip', 'big.zip'],
  ])('passes only the file name of %s', async (_name, filename, expected) => {
    expect((await buildCapture(deps(), item({ filename }))).filename).toBe(expected);
  });

  it('leaves out the filename when the browser has not chosen one yet', async () => {
    expect('filename' in (await buildCapture(deps(), item({ filename: '' })))).toBe(false);
  });
});

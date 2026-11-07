import { describe, expect, it } from 'vitest';
import { headersForUrl, pickAllowedHeaders } from '../src/headers';

describe('pickAllowedHeaders', () => {
  it('keeps only Cookie, Referer and User-Agent strings', () => {
    expect(
      pickAllowedHeaders({ Cookie: 'a=1', Range: 'bytes=5-9', Authorization: 'x', 'User-Agent': 7, Referer: 'https://site.example/p' }),
    ).toEqual({ Cookie: 'a=1', Referer: 'https://site.example/p' });
  });

  it('drops values with control characters so a header can never be split', () => {
    expect(pickAllowedHeaders({ Cookie: 'a=1\r\nX-Evil: 1', Referer: 'https://ok/' })).toEqual({ Referer: 'https://ok/' });
  });

  it('returns nothing for non-objects', () => {
    expect(pickAllowedHeaders(null)).toEqual({});
    expect(pickAllowedHeaders('Cookie: a=1')).toEqual({});
    expect(pickAllowedHeaders(undefined)).toEqual({});
  });
});

describe('headersForUrl', () => {
  const all = { Cookie: 'sid=1', Referer: 'https://site.example/p', 'User-Agent': 'UA/1' };

  it('keeps the Cookie for the same origin', () => {
    expect(headersForUrl(all, 'http://127.0.0.1:5000/file', 'http://127.0.0.1:5000/start')).toEqual(all);
  });

  it('drops the Cookie for a different port or a different host, keeping Referer and User-Agent', () => {
    const expected = { Referer: all.Referer, 'User-Agent': all['User-Agent'] };
    expect(headersForUrl(all, 'http://127.0.0.1:5001/file', 'http://127.0.0.1:5000/start')).toEqual(expected);
    expect(headersForUrl(all, 'http://cdn.example/file', 'http://site.example/start')).toEqual(expected);
  });

  it('drops the Cookie when either URL cannot be parsed', () => {
    expect(headersForUrl(all, 'not a url', 'http://site.example/')).not.toHaveProperty('Cookie');
  });
});

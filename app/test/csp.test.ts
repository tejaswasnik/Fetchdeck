import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(import.meta.dirname, '../renderer/index.html'), 'utf8');
const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';

describe('renderer Content-Security-Policy', () => {
  it('allows data: images, because Vite inlines small images such as the logo as data URIs', () => {
    expect(csp).toMatch(/img-src[^;]*\bdata:/);
  });

  it('still blocks remote scripts', () => {
    expect(csp).toMatch(/script-src 'self'(;|$)/);
  });
});

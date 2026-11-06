import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script with no type declarations
import { changelogSection } from './changelogSection.mjs';

const log = `# Changelog

## 0.2.0 - 2027-01-01

- Newer thing.

## 0.1.0 - 2026-11-06

- First thing.
- Second thing.
`;

describe('changelogSection', () => {
  it('returns only the requested version', () => {
    expect(changelogSection(log, '0.1.0')).toBe('- First thing.\n- Second thing.');
    expect(changelogSection(log, '0.2.0')).toBe('- Newer thing.');
  });

  it('does not confuse 0.1.0 with 0.1.01 or a prefix', () => {
    expect(changelogSection(log, '0.1')).toBeNull();
  });

  it('returns null for an unknown version', () => {
    expect(changelogSection(log, '9.9.9')).toBeNull();
  });

  it('works on the real changelog', async () => {
    const { readFileSync } = await import('node:fs');
    expect(changelogSection(readFileSync('CHANGELOG.md', 'utf8'), '0.1.0')).toContain('Download engine');
  });
});

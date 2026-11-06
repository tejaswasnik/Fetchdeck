import { expect } from 'vitest';
import type { SegmentState } from '../../src/types';

export const assertCovers = (segments: SegmentState[], size: number): void => {
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0]!.start).toBe(0);
  expect(segments[segments.length - 1]!.end).toBe(size - 1);
  for (let i = 1; i < segments.length; i++) {
    expect(segments[i]!.start).toBe(segments[i - 1]!.end + 1);
  }
};

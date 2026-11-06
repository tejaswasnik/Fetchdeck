import { describe, expect, it } from 'vitest';
import { planSegments, stealWork } from '../src/planner';
import type { SegmentState } from '../src/types';
import { assertCovers } from './helpers/assertCovers';

const MIB = 1_048_576;

describe('planSegments', () => {
  it('8 MiB gives 8 segments of 1 MiB', () => {
    const segs = planSegments(8 * MIB);
    expect(segs).toHaveLength(8);
    segs.forEach((s) => expect(s.end - s.start + 1).toBe(MIB));
  });

  it('10 bytes with max 3 and min 1 gives [0-2],[3-5],[6-9]', () => {
    expect(planSegments(10, 3, 1).map((s) => [s.start, s.end])).toEqual([[0, 2], [3, 5], [6, 9]]);
  });

  it('100 bytes with defaults gives one segment 0-99', () => {
    expect(planSegments(100)).toEqual([{ start: 0, end: 99, downloaded: 0 }]);
  });

  it('size 0 gives none', () => {
    expect(planSegments(0)).toEqual([]);
  });

  it('for 50 random sizes: contiguous, no overlap', () => {
    for (let i = 0; i < 50; i++) {
      const size = 1 + Math.floor(Math.random() * 50 * MIB);
      assertCovers(planSegments(size), size);
    }
  });
});

describe('stealWork', () => {
  const segs = (): SegmentState[] => [
    { start: 0, end: 4 * MIB - 1, downloaded: 3 * MIB },
    { start: 4 * MIB, end: 10 * MIB - 1, downloaded: 0 },
  ];

  it('splits the segment with the largest remainder', () => {
    const r = stealWork(segs())!;
    expect(r.segments).toHaveLength(3);
    expect(r.segments[1]!.end).toBeLessThan(10 * MIB - 1);
    expect(r.created).toEqual(r.segments[2]);
  });

  it('original keeps the ceil half', () => {
    const input = [{ start: 0, end: 2 * MIB, downloaded: 0 }]; // 2 MiB + 1 remaining
    const r = stealWork(input)!;
    expect(r.segments[0]!.end - r.segments[0]!.start + 1).toBe(MIB + 1);
    expect(r.created.end - r.created.start + 1).toBe(MIB);
  });

  it('returns null under 1 MiB remaining', () => {
    expect(stealWork([{ start: 0, end: MIB - 2, downloaded: 0 }])).toBeNull();
  });

  it('combined segments still cover the same range', () => {
    assertCovers(stealWork(segs())!.segments, 10 * MIB);
  });

  it('does not mutate its input', () => {
    const input = segs();
    const copy = structuredClone(input);
    stealWork(input);
    expect(input).toEqual(copy);
  });
});

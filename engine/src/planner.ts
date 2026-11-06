import type { SegmentState } from './types';

const MIB = 1_048_576;

export const planSegments = (size: number, maxSegments = 8, minSegmentBytes = MIB): SegmentState[] => {
  if (size <= 0) return [];
  const count = Math.min(maxSegments, Math.max(1, Math.floor(size / minSegmentBytes)));
  const base = Math.floor(size / count);
  return Array.from({ length: count }, (_, i) => ({
    start: i * base,
    end: i === count - 1 ? size - 1 : (i + 1) * base - 1,
    downloaded: 0,
  }));
};

const remainingBytes = (s: SegmentState): number => s.end - (s.start + s.downloaded) + 1;

export const stealWork = (
  segments: SegmentState[],
  minSplitBytes = MIB,
): { segments: SegmentState[]; created: SegmentState } | null => {
  let victim = -1;
  let most = 0;
  segments.forEach((s, i) => {
    const left = remainingBytes(s);
    if (left > most) {
      most = left;
      victim = i;
    }
  });
  if (victim < 0 || most < minSplitBytes || Math.floor(most / 2) < 1) return null;

  const original = segments[victim]!;
  const keep = Math.ceil(most / 2);
  const splitEnd = original.start + original.downloaded + keep - 1;
  const created: SegmentState = { start: splitEnd + 1, end: original.end, downloaded: 0 };
  const next = segments.map((s) => ({ ...s }));
  next[victim] = { ...original, end: splitEnd };
  next.splice(victim + 1, 0, created);
  return { segments: next, created };
};

import type { SegmentState } from '@fetchdeck/engine';

type SegmentBarProps = {
  segments: SegmentState[];
  percent: number | null;
  live: boolean;
  tall?: boolean;
  label?: string;
};

const lengthOf = (s: SegmentState): number => s.end - s.start + 1;

// One dash per byte range, each filled by how much of that range has arrived.
// Without ranges (single stream or not planned yet) it is a single track.
export const SegmentBar = ({ segments, percent, live, tall = false, label = 'Progress' }: SegmentBarProps) => {
  const tone = live ? 'segbar--live' : 'segbar--idle';
  const parts =
    segments.length > 0
      ? segments.map((s) => ({ weight: lengthOf(s), fill: Math.min(100, (s.downloaded / lengthOf(s)) * 100) }))
      : [{ weight: 1, fill: percent ?? 0 }];
  return (
    <div
      className={`segbar ${tone} ${tall ? 'segbar--tall' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      {parts.map((part, index) => (
        <span key={index} className="segbar__seg" style={{ flexGrow: part.weight }}>
          <span className="segbar__fill" style={{ width: `${part.fill}%` }} />
        </span>
      ))}
    </div>
  );
};

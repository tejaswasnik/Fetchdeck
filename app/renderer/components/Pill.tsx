import type { ReactNode } from 'react';

export type PillTone = 'warning' | 'negative' | 'neutral';

export const Pill = ({ tone, children }: { tone: PillTone; children: ReactNode }) => (
  <span className={`pill pill--${tone}`}>{children}</span>
);

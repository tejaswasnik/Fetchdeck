type Sample = { at: number; bytes: number };

export class SpeedMeter {
  private samples: Sample[] = [];
  private firstAt: number | null = null;

  constructor(private readonly windowMs = 5000) {}

  add(bytes: number, nowMs: number): void {
    this.firstAt ??= nowMs;
    this.samples.push({ at: nowMs, bytes });
  }

  bytesPerSecond(nowMs: number): number {
    const cutoff = nowMs - this.windowMs;
    this.samples = this.samples.filter((s) => s.at >= cutoff);
    if (this.samples.length === 0 || this.firstAt === null) return 0;
    const total = this.samples.reduce((sum, s) => sum + s.bytes, 0);
    const spanMs = Math.max(1, Math.min(this.windowMs, nowMs - this.firstAt));
    return (total * 1000) / spanMs;
  }
}

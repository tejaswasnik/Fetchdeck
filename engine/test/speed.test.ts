import { describe, expect, it } from 'vitest';
import { SpeedMeter } from '../src/speed';

describe('SpeedMeter', () => {
  it('reports the average over the window', () => {
    const meter = new SpeedMeter(5000);
    meter.add(5000, 0);
    meter.add(5000, 4000);
    expect(meter.bytesPerSecond(5000)).toBe(2000);
  });

  it('samples older than the window drop out', () => {
    const meter = new SpeedMeter(5000);
    meter.add(5000, 0);
    meter.add(5000, 6000);
    expect(meter.bytesPerSecond(9000)).toBe(1000);
  });
});

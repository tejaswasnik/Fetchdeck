import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptureLine, type CaptureInput } from '../main/captureLine';

const input = (n: number): CaptureInput => ({
  url: `https://site.example/file${n}.zip`,
  headers: { Cookie: `sid=SECRET${n}`, Referer: 'https://site.example/p' },
  filename: `file${n}.zip`,
  size: 6_000_000 + n,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const submit = (line: ReturnType<typeof createCaptureLine>, n: number): string => {
  const result = line.submit(input(n));
  if (!result.ok) throw new Error('line full');
  return result.id;
};

describe('capture line order', () => {
  it('shows the first capture and counts the ones waiting behind it', () => {
    const line = createCaptureLine();
    const a = submit(line, 1);
    const b = submit(line, 2);
    submit(line, 3);
    expect(line.view()).toEqual({ captureId: a, url: input(1).url, filename: 'file1.zip', size: 6_000_001, waiting: 2 });
    line.accept(a);
    expect(line.view()).toMatchObject({ captureId: b, waiting: 1 });
    line.dismiss(b);
    expect(line.view()).toMatchObject({ url: input(3).url, waiting: 0 });
  });

  it('is empty when nothing is pending', () => {
    expect(createCaptureLine().view()).toBeNull();
  });

  it('refuses the 21st pending capture and takes another once one is handled', () => {
    const line = createCaptureLine();
    const ids = Array.from({ length: 20 }, (_, i) => submit(line, i));
    expect(line.submit(input(99))).toEqual({ ok: false, reason: 'full' });
    line.dismiss(ids[0] as string);
    expect(line.submit(input(99)).ok).toBe(true);
  });

  it('the view and its change notifications never carry the headers', () => {
    const line = createCaptureLine();
    const seen: string[] = [];
    line.onChange(() => seen.push(JSON.stringify(line.view())));
    submit(line, 1);
    expect(seen).toHaveLength(1);
    expect(seen.join()).not.toContain('SECRET');
    expect(Object.keys(line.view() ?? {}).sort()).toEqual(['captureId', 'filename', 'size', 'url', 'waiting']);
  });

  it('take() hands main the whole capture, but only while it is pending', () => {
    const line = createCaptureLine();
    const id = submit(line, 1);
    expect(line.take(id)).toEqual(input(1));
    line.accept(id);
    expect(() => line.take(id)).toThrow('That capture is gone.');
  });

  it('accepting a capture that is gone throws; dismissing one is a no-op', () => {
    const line = createCaptureLine();
    expect(() => line.accept('nope')).toThrow('That capture is gone.');
    expect(() => line.dismiss('nope')).not.toThrow();
  });
});

describe('capture line long-poll', () => {
  it('resolves accepted as soon as the capture is accepted', async () => {
    const line = createCaptureLine();
    const id = submit(line, 1);
    const outcome = line.poll(id, 20_000);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false);
    line.accept(id);
    await expect(outcome).resolves.toBe('accepted');
  });

  it('answers pending after the wait when nothing happened, and the capture is still there', async () => {
    const line = createCaptureLine();
    const id = submit(line, 1);
    const outcome = line.poll(id, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(outcome).resolves.toBe('pending');
    expect(line.view()?.captureId).toBe(id);
  });

  it('a finished capture is delivered once, then it is unknown', async () => {
    const line = createCaptureLine();
    const id = submit(line, 1);
    line.dismiss(id);
    await expect(line.poll(id, 0)).resolves.toBe('dismissed');
    await expect(line.poll(id, 0)).resolves.toBe('unknown');
  });

  it('an unknown id is unknown', async () => {
    await expect(createCaptureLine().poll('nope', 0)).resolves.toBe('unknown');
  });
});

describe('capture line expiry', () => {
  it('drops a capture nobody polls for 60 seconds and tells the listeners', async () => {
    const line = createCaptureLine();
    const id = submit(line, 1);
    let changes = 0;
    line.onChange(() => changes++);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(line.view()?.captureId).toBe(id);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(line.view()).toBeNull();
    expect(changes).toBe(1);
    await expect(line.poll(id, 0)).resolves.toBe('unknown');
  });

  it('polling keeps it alive', async () => {
    const line = createCaptureLine();
    const id = submit(line, 1);
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(line.poll(id, 0)).resolves.toBe('pending');
    }
    expect(line.view()?.captureId).toBe(id);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(line.view()).toBeNull();
  });

  it('a capture that expires while someone is waiting on it answers unknown', async () => {
    const line = createCaptureLine({ expiryMs: 1_000 });
    const id = submit(line, 1);
    const outcome = line.poll(id, 20_000);
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(outcome).resolves.toBe('unknown');
  });
});

describe('capture line closeAll', () => {
  it('dismisses everything, ends every pending poll as dismissed and empties the view', async () => {
    const line = createCaptureLine();
    const a = submit(line, 1);
    const b = submit(line, 2);
    const pollA = line.poll(a, 20_000);
    const pollB = line.poll(b, 20_000);
    line.closeAll();
    await expect(pollA).resolves.toBe('dismissed');
    await expect(pollB).resolves.toBe('dismissed');
    expect(line.view()).toBeNull();
  });
});

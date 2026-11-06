import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSmokeTest, isSmokeRun } from '../main/smoke';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('isSmokeRun', () => {
  it('is on only when --smoke is passed', () => {
    expect(isSmokeRun(['electron', '.', '--smoke'])).toBe(true);
    expect(isSmokeRun(['electron', '.'])).toBe(false);
  });
});

describe('attachSmokeTest', () => {
  it('exits 0 when the page finishes loading', () => {
    const page = new EventEmitter();
    const exit = vi.fn();
    attachSmokeTest(page, exit);
    page.emit('did-finish-load');
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('exits 1 when the page fails to load', () => {
    const page = new EventEmitter();
    const exit = vi.fn();
    attachSmokeTest(page, exit);
    page.emit('did-fail-load');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits 1 after the timeout if nothing happens', () => {
    const exit = vi.fn();
    attachSmokeTest(new EventEmitter(), exit, 30_000);
    vi.advanceTimersByTime(29_999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('reports only the first outcome', () => {
    const page = new EventEmitter();
    const exit = vi.fn();
    attachSmokeTest(page, exit, 1000);
    page.emit('did-finish-load');
    page.emit('did-fail-load');
    vi.advanceTimersByTime(5000);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

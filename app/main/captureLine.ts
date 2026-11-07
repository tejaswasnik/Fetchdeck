import { randomUUID } from 'node:crypto';
import type { RequestHeaders } from '@fetchdeck/engine';
import type { CaptureView } from '../shared/api';

// No Electron imports here: the extension's end-to-end test runs this file in plain Node.

export type CaptureInput = { url: string; headers: RequestHeaders; filename: string | null; size: number | null };
export type CaptureOutcome = 'pending' | 'accepted' | 'dismissed';

export type CaptureLine = {
  submit(input: CaptureInput): { ok: true; id: string } | { ok: false; reason: 'full' };
  /** The capture the dialog shows now (the first pending one). Safe for the page: no headers. */
  view(): CaptureView | null;
  /** The whole capture, for main only. Throws while it is not pending. */
  take(id: string): CaptureInput;
  /** Throws if the capture is gone, so the caller can say it was already handled. */
  accept(id: string): void;
  /** A no-op if the capture is gone. */
  dismiss(id: string): void;
  /** Long-poll for the extension: waits up to `waitMs` for an answer. Every call also keeps the capture alive. */
  poll(id: string, waitMs: number): Promise<CaptureOutcome | 'unknown'>;
  /** Dismisses everything pending (server stopped, app quitting) so every browser download resumes. */
  closeAll(): void;
  onChange(listener: () => void): () => void;
};

type Answer = CaptureOutcome | 'unknown';
type Item = {
  id: string;
  input: CaptureInput;
  state: CaptureOutcome;
  expiry: ReturnType<typeof setTimeout> | undefined;
  waiters: Set<(answer: Answer) => void>;
};

const GONE = 'That capture is gone.';

export const createCaptureLine = (options: { cap?: number; expiryMs?: number } = {}): CaptureLine => {
  const cap = options.cap ?? 20;
  const expiryMs = options.expiryMs ?? 60_000;
  const items = new Map<string, Item>(); // insertion order = line order
  const listeners = new Set<() => void>();

  const emit = (): void => listeners.forEach((listener) => listener());
  const pending = (): Item[] => [...items.values()].filter((item) => item.state === 'pending');

  const forget = (item: Item): void => {
    clearTimeout(item.expiry);
    items.delete(item.id);
  };

  // A capture the extension stopped asking about is dropped: the browser has already moved on.
  const touch = (item: Item): void => {
    clearTimeout(item.expiry);
    item.expiry = setTimeout(() => {
      const wasPending = item.state === 'pending';
      forget(item);
      item.waiters.forEach((wake) => wake('unknown'));
      if (wasPending) emit();
    }, expiryMs);
    item.expiry.unref?.();
  };

  const settle = (item: Item, state: 'accepted' | 'dismissed'): void => {
    item.state = state;
    [...item.waiters].forEach((wake) => wake(state));
  };

  // A finished answer is handed over once, then forgotten.
  const deliver = (item: Item): Answer => {
    const state = item.state;
    if (state !== 'pending') forget(item);
    return state;
  };

  const pendingItem = (id: string): Item => {
    const item = items.get(id);
    if (!item || item.state !== 'pending') throw new Error(GONE);
    return item;
  };

  return {
    submit(input) {
      if (pending().length >= cap) return { ok: false, reason: 'full' };
      const item: Item = { id: randomUUID(), input, state: 'pending', expiry: undefined, waiters: new Set() };
      items.set(item.id, item);
      touch(item);
      emit();
      return { ok: true, id: item.id };
    },

    view() {
      const [first, ...rest] = pending();
      if (!first) return null;
      const { url, filename, size } = first.input;
      return { captureId: first.id, url, filename, size, waiting: rest.length };
    },

    take: (id) => pendingItem(id).input,

    accept(id) {
      settle(pendingItem(id), 'accepted');
      emit();
    },

    dismiss(id) {
      const item = items.get(id);
      if (!item || item.state !== 'pending') return;
      settle(item, 'dismissed');
      emit();
    },

    poll(id, waitMs) {
      const item = items.get(id);
      if (!item) return Promise.resolve('unknown');
      touch(item);
      if (item.state !== 'pending' || waitMs <= 0) return Promise.resolve(deliver(item));
      return new Promise<Answer>((resolve) => {
        const finish = (answer: Answer): void => {
          clearTimeout(timer);
          item.waiters.delete(finish);
          if (answer === 'pending') {
            if (items.get(id) === item) touch(item);
          } else if (answer !== 'unknown') {
            forget(item);
          }
          resolve(answer);
        };
        const timer = setTimeout(() => finish('pending'), waitMs);
        item.waiters.add(finish);
      });
    },

    closeAll() {
      for (const item of pending()) settle(item, 'dismissed');
      emit();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
};

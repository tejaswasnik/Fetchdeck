import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpStatusError, ShortSegmentError } from './errors';
import { reserveName } from './filename';
import { planSegments, stealWork } from './planner';
import { probe } from './probe';
import { backoffMs, classifyFailure, type Failure } from './retry';
import { runSegment } from './segment';
import { SpeedMeter } from './speed';
import { saveRecord } from './store';
import type { DownloadRecord, EngineEvent, ProbeResult, SegmentState } from './types';

export type DownloadOptions = {
  recordPath: string;
  maxSegments?: number; // default 8
  workStealing?: boolean; // default true
  saveProgressEveryMs?: number; // default 1000
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  writeAt?: (handle: FileHandle, data: Uint8Array, position: number) => Promise<void>;
  syncFile?: (handle: FileHandle) => Promise<void>;
};

export const createRecord = (url: string, saveDir: string, id: string = randomUUID()): DownloadRecord => ({
  id,
  url,
  finalUrl: url,
  filename: '',
  saveDir,
  size: null,
  etag: null,
  lastModified: null,
  rangeSupported: true,
  status: 'queued',
  segments: [],
  createdAt: new Date().toISOString(),
});

const PROGRESS_EVERY_MS = 250;
const MAX_SERVER_ATTEMPTS = 5;

// A failure that should end the download in the `error` status with a readable message.
class FatalDownloadError extends Error {}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

const defaultWriteAt = async (handle: FileHandle, data: Uint8Array, position: number): Promise<void> => {
  let written = 0;
  while (written < data.length) {
    const { bytesWritten } = await handle.write(data, written, data.length - written, position + written);
    written += bytesWritten;
  }
};

const defaultSyncFile = (handle: FileHandle): Promise<void> => handle.sync();

const permanentMessage = (status: number): string => {
  if (status === 404) return 'File not found (404)';
  if (status === 401) return 'Access denied (401)';
  return `The server refused the request (${status})`;
};

const messageFor = (failure: Failure, err: unknown): string => {
  switch (failure.kind) {
    case 'permanent':
      return permanentMessage(failure.status);
    case 'linkExpired':
      return err instanceof HttpStatusError ? 'The download link has expired or access was denied' : 'Download link expired';
    case 'server':
      return 'The server keeps returning errors. Try again later.';
    case 'fatal':
      return failure.message;
    default:
      return err instanceof Error ? err.message : String(err);
  }
};

type WorkerState = {
  gotBytes: boolean;
  netAttempt: number;
  serverAttempts: number;
  linkRetried: boolean;
  retryingServer: boolean;
};

const newWorkerState = (): WorkerState => ({
  gotBytes: false,
  netAttempt: 0,
  serverAttempts: 0,
  linkRetried: false,
  retryingServer: false,
});

const remaining = (s: SegmentState): number => s.end - (s.start + s.downloaded) + 1;

export class Download extends EventEmitter {
  private readonly _record: DownloadRecord;
  private readonly options: Required<DownloadOptions>;
  private readonly meter = new SpeedMeter();

  private runPromise: Promise<void> | null = null;
  private controller = new AbortController();
  private pauseRequested = false;
  private fallbackRequested = false;
  private diskFull = false;
  private failure: unknown = null;

  private singleBytes = 0;
  private activeWorkers = 0;
  private waitingWorkers = 0;
  private serverRetrying = 0;

  private progressTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> | null = null;

  constructor(record: DownloadRecord, options: DownloadOptions) {
    super();
    this._record = record;
    this.options = {
      maxSegments: 8,
      workStealing: true,
      saveProgressEveryMs: 1000,
      sleep: defaultSleep,
      writeAt: defaultWriteAt,
      syncFile: defaultSyncFile,
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    } as Required<DownloadOptions>;
  }

  get record(): DownloadRecord {
    return this._record;
  }

  start(): Promise<void> {
    if (this.runPromise) return this.runPromise;
    if (this._record.status === 'done') return Promise.resolve();
    const run = this.run().finally(() => {
      this.runPromise = null;
    });
    this.runPromise = run;
    return run;
  }

  async pause(): Promise<void> {
    if (!this.runPromise) {
      if (this._record.status === 'queued' || this._record.status === 'downloading' || this._record.status === 'waiting') {
        this.setStatus('paused');
        await this.persist();
      }
      return;
    }
    this.pauseRequested = true;
    this.controller.abort();
    await this.runPromise;
  }

  // ---- lifecycle -----------------------------------------------------------

  private async run(): Promise<void> {
    this.controller = new AbortController();
    this.pauseRequested = false;
    this.fallbackRequested = false;
    this.diskFull = false;
    this.failure = null;
    this.activeWorkers = 0;
    this.waitingWorkers = 0;
    this.serverRetrying = 0;
    delete this._record.error;
    this.setStatus('downloading');
    await this.persist();

    let outcome: 'done' | 'paused' | 'error' = 'done';
    let errorMessage = '';
    try {
      outcome = await this.execute();
    } catch (err) {
      if (this.pauseRequested) {
        outcome = 'paused';
      } else {
        outcome = 'error';
        errorMessage = err instanceof FatalDownloadError ? err.message : messageFor(classifyFailure(err), err);
      }
    }

    if (outcome === 'done') {
      this.emitProgress();
      this._record.status = 'done';
      await this.persist();
      this.emit('event', { type: 'status', status: 'done' } satisfies EngineEvent);
    } else if (outcome === 'paused') {
      this.setStatus('paused', this.diskFull ? 'Disk full' : undefined);
      await this.persist();
    } else {
      this.setStatus('error', errorMessage);
      await this.persist();
    }
  }

  private async execute(): Promise<'done' | 'paused'> {
    const record = this._record;
    const probed = await this.probeWithRetries();

    const resuming = record.filename !== '';
    let reset = false;
    if (!resuming) {
      record.filename = await reserveName(record.saveDir, probed.filename);
      this.applyProbe(probed);
      reset = true;
    } else if (probed.size !== record.size || probed.etag !== record.etag || !probed.rangeSupported) {
      // The file changed on the server (or cannot be resumed): start over.
      this.applyProbe(probed);
      reset = true;
    } else {
      record.finalUrl = probed.finalUrl;
    }

    const parallel = record.rangeSupported && record.size !== null && record.size > 0;
    await mkdir(record.saveDir, { recursive: true });
    const partPath = join(record.saveDir, `${record.filename}.part`);

    let handle: FileHandle | null = null;
    if (!reset) {
      try {
        handle = await open(partPath, 'r+');
        if ((await handle.stat()).size !== record.size) {
          await handle.close();
          handle = null;
          reset = true;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        reset = true;
      }
    }
    if (reset) {
      record.segments = parallel ? planSegments(record.size as number, this.options.maxSegments) : [];
      handle = await open(partPath, 'w+');
      if (parallel) await handle.truncate(record.size as number);
    }
    const file = handle as FileHandle;
    this.singleBytes = 0;

    try {
      this.startTimers(file);
      if (parallel) {
        await this.runParallel(file);
        if (this.fallbackRequested && !this.pauseRequested && !this.failure) {
          this.fallbackRequested = false;
          this.controller = new AbortController();
          record.rangeSupported = false;
          record.segments = [];
          await this.runSingle(file);
        }
      } else if (record.size !== 0) {
        await this.runSingle(file);
      }
      if (this.failure) throw this.failure;
      if (this.pauseRequested || this.diskFull) return 'paused';
      if (parallel && record.segments.some((s) => remaining(s) > 0)) {
        throw new FatalDownloadError('The download ended before all data arrived');
      }
      await this.options.syncFile(file);
    } finally {
      this.stopTimers();
      await this.saving;
      await file.close();
    }

    await rename(partPath, join(record.saveDir, record.filename));
    return 'done';
  }

  private applyProbe(probed: ProbeResult): void {
    const record = this._record;
    record.finalUrl = probed.finalUrl;
    record.size = probed.size;
    record.etag = probed.etag;
    record.lastModified = probed.lastModified;
    record.rangeSupported = probed.rangeSupported;
  }

  // ---- probing -------------------------------------------------------------

  private async probeWithRetries(): Promise<ProbeResult> {
    let netAttempt = 0;
    let serverAttempts = 0;
    for (;;) {
      try {
        return await probe(this._record.url, this.controller.signal);
      } catch (err) {
        if (this.controller.signal.aborted) throw err;
        const failure = classifyFailure(err);
        if (failure.kind === 'network') {
          if (!(await this.wait(backoffMs(++netAttempt), true))) throw err;
        } else if (failure.kind === 'server' && ++serverAttempts < MAX_SERVER_ATTEMPTS) {
          if (!(await this.wait(failure.retryAfterMs ?? backoffMs(serverAttempts), false))) throw err;
        } else {
          throw new FatalDownloadError(messageFor(failure, err));
        }
      }
    }
  }

  // ---- parallel download ---------------------------------------------------

  private allowedWorkers(): number {
    const max = this.options.maxSegments;
    return this.serverRetrying > 0 ? Math.max(1, Math.floor(max / 2)) : max;
  }

  private async runParallel(handle: FileHandle): Promise<void> {
    const live = this._record.segments;
    const pending = live.filter((s) => remaining(s) > 0);
    const running = new Set<Promise<void>>();
    let finished = 0;

    for (;;) {
      while (!this.controller.signal.aborted && running.size < this.allowedWorkers()) {
        let segment: SegmentState | null | undefined = pending.shift();
        if (!segment && finished > 0 && this.options.workStealing && running.size > 0) {
          segment = this.steal(live);
        }
        if (!segment) break;
        const worker: Promise<void> = this.runWorker(segment, handle).finally(() => {
          running.delete(worker);
          finished++;
        });
        running.add(worker);
      }
      if (running.size === 0) break;
      await Promise.race(running);
    }
  }

  // Shorten the victim in place (its running worker notices on the next chunk) and add the new tail.
  private steal(live: SegmentState[]): SegmentState | null {
    const result = stealWork(live);
    if (!result) return null;
    const index = result.segments.indexOf(result.created) - 1;
    live[index]!.end = result.segments[index]!.end;
    live.splice(index + 1, 0, result.created);
    return result.created;
  }

  private async runWorker(segment: SegmentState, handle: FileHandle): Promise<void> {
    const state = newWorkerState();
    this.activeWorkers++;
    try {
      await this.withRetries(
        () =>
          runSegment({
            url: this._record.finalUrl,
            segment,
            etag: this._record.etag,
            signal: this.controller.signal,
            writeAt: (data, position) => this.options.writeAt(handle, data, position),
            onBytes: (count) => {
              state.gotBytes = true;
              this.onBytes(count);
            },
          }),
        state,
        () => {
          this.fallbackRequested = true;
          this.controller.abort();
        },
      );
    } catch (err) {
      this.failure ??= err;
      this.controller.abort();
    } finally {
      this.activeWorkers--;
      if (state.retryingServer) this.serverRetrying--;
    }
  }

  // ---- single stream -------------------------------------------------------

  private async runSingle(handle: FileHandle): Promise<void> {
    const state = newWorkerState();
    this.activeWorkers++;
    try {
      await this.withRetries(
        async () => {
          this.singleBytes = 0;
          await handle.truncate(0);
          const signal = this.controller.signal;
          const res = await fetch(this._record.finalUrl, { headers: { 'Accept-Encoding': 'identity' }, signal });
          if (!res.ok || !res.body) {
            await res.body?.cancel();
            throw new HttpStatusError(res.status);
          }
          const reader = res.body.getReader();
          try {
            for (;;) {
              let result: ReadableStreamReadResult<Uint8Array>;
              try {
                result = await reader.read();
              } catch (err) {
                if (signal.aborted) throw err;
                throw new ShortSegmentError('Connection dropped mid-download', { cause: err });
              }
              if (result.done) break;
              await this.options.writeAt(handle, result.value, this.singleBytes);
              this.singleBytes += result.value.length;
              state.gotBytes = true;
              this.onBytes(result.value.length);
            }
          } finally {
            await reader.cancel().catch(() => undefined);
          }
          const size = this._record.size;
          if (size !== null && this.singleBytes < size) throw new ShortSegmentError();
        },
        state,
        () => {
          throw new FatalDownloadError('The server behaved unexpectedly');
        },
      );
    } catch (err) {
      this.failure ??= err;
    } finally {
      this.activeWorkers--;
    }
  }

  // ---- retry policy --------------------------------------------------------

  // Runs `op` until it succeeds, applying the per-failure policy. Returns quietly when aborted.
  private async withRetries(op: () => Promise<void>, state: WorkerState, onRangeIgnored: () => void): Promise<void> {
    for (;;) {
      state.gotBytes = false;
      try {
        await op();
        this.endServerRetry(state);
        return;
      } catch (err) {
        if (this.controller.signal.aborted) return;
        if (state.gotBytes) {
          state.netAttempt = 0;
          state.serverAttempts = 0;
          state.linkRetried = false;
          this.endServerRetry(state);
        }
        const failure = classifyFailure(err);
        switch (failure.kind) {
          case 'aborted':
            return;
          case 'network':
            if (!(await this.wait(backoffMs(++state.netAttempt), true))) return;
            break;
          case 'server': {
            if (++state.serverAttempts >= MAX_SERVER_ATTEMPTS) throw new FatalDownloadError(messageFor(failure, err));
            if (!state.retryingServer) {
              state.retryingServer = true;
              this.serverRetrying++;
            }
            if (!(await this.wait(failure.retryAfterMs ?? backoffMs(state.serverAttempts), false))) return;
            break;
          }
          case 'linkExpired': {
            if (state.linkRetried) throw new FatalDownloadError('The download link has expired. Try adding it again.');
            state.linkRetried = true;
            try {
              this._record.finalUrl = (await probe(this._record.url, this.controller.signal)).finalUrl;
            } catch (probeErr) {
              if (this.controller.signal.aborted) return;
              throw new FatalDownloadError(messageFor(classifyFailure(probeErr), probeErr));
            }
            break;
          }
          case 'rangeIgnored':
            onRangeIgnored();
            return;
          case 'diskFull':
            this.diskFull = true;
            this.controller.abort();
            return;
          default:
            throw new FatalDownloadError(messageFor(failure, err));
        }
      }
    }
  }

  private endServerRetry(state: WorkerState): void {
    if (!state.retryingServer) return;
    state.retryingServer = false;
    this.serverRetrying--;
  }

  // Sleeps; returns false if aborted. Network waits can flip the status to `waiting`.
  private async wait(ms: number, network: boolean): Promise<boolean> {
    if (network) {
      this.waitingWorkers++;
      if (this.waitingWorkers >= this.activeWorkers && this._record.status === 'downloading') {
        this.setStatus('waiting');
      }
    }
    try {
      await this.options.sleep(ms, this.controller.signal);
      return true;
    } catch {
      return false;
    } finally {
      if (network) this.waitingWorkers--;
    }
  }

  // ---- progress, saving, events -------------------------------------------

  private onBytes(count: number): void {
    this.meter.add(count, Date.now());
    if (this._record.status === 'waiting') this.setStatus('downloading');
  }

  private bytesDone(): number {
    const record = this._record;
    if (record.status === 'done' && record.size !== null) return record.size;
    if (record.segments.length === 0) return this.singleBytes;
    return record.segments.reduce((sum, s) => sum + Math.min(s.downloaded, s.end - s.start + 1), 0);
  }

  private emitProgress(): void {
    const bytesDone = this.bytesDone();
    const speed = this.meter.bytesPerSecond(Date.now());
    const size = this._record.size;
    const etaSeconds = size !== null && speed > 0 ? Math.max(0, (size - bytesDone) / speed) : null;
    this.emit('event', { type: 'progress', bytesDone, speed, etaSeconds } satisfies EngineEvent);
  }

  private setStatus(status: DownloadRecord['status'], error?: string): void {
    this._record.status = status;
    if (error !== undefined) this._record.error = error;
    else delete this._record.error;
    this.emit('event', { type: 'status', status, ...(error !== undefined ? { error } : {}) } satisfies EngineEvent);
  }

  private persist(): Promise<void> {
    return saveRecord(this.options.recordPath, this._record);
  }

  private startTimers(handle: FileHandle): void {
    this.progressTimer = setInterval(() => this.emitProgress(), PROGRESS_EVERY_MS);
    // Data must reach the disk before the record claims it did, so sync first.
    this.saveTimer = setInterval(() => {
      if (this.saving) return;
      const checkpoint = (async () => {
        await this.options.syncFile(handle);
        await this.persist();
      })()
        .catch(() => undefined)
        .finally(() => {
          this.saving = null;
        });
      this.saving = checkpoint;
    }, this.options.saveProgressEveryMs);
  }

  private stopTimers(): void {
    if (this.progressTimer) clearInterval(this.progressTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.progressTimer = null;
    this.saveTimer = null;
  }
}

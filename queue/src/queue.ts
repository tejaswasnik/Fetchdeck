import { EventEmitter } from 'node:events';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CorruptRecordError,
  Download,
  assertHttpUrl,
  createRecord,
  deleteRecord,
  loadRecord,
  saveRecord,
  type DownloadOptions,
  type DownloadRecord,
  type EngineEvent,
} from '@fetchdeck/engine';
import { loadOrder, saveOrder } from './orderStore';

export type QueueOptions = {
  stateDir: string;
  maxConcurrent?: number; // default 3
  maxSegments?: number;
  downloadOptions?: Partial<DownloadOptions>;
};

const ORDER_FILE = 'order.json';

type Entry = { download: Download; recordPath: string; running: boolean; startedAt: number };

export class DownloadQueue extends EventEmitter {
  private readonly entries = new Map<string, Entry>(); // insertion order = line order
  private maxConcurrent: number;
  private maxSegments: number | undefined;
  private shuttingDown = false;
  private starts = 0; // stamps Entry.startedAt so the newest running download can be found

  constructor(private readonly options: QueueOptions) {
    super();
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.maxSegments = options.maxSegments;
  }

  // Applies live: a lower limit stops nothing, it only holds back new starts until fewer are running.
  setMaxConcurrent(n: number): void {
    if (Number.isNaN(n)) return;
    this.maxConcurrent = Math.min(6, Math.max(1, Math.trunc(n)));
    this.schedule();
  }

  // Only downloads registered afterwards use the new value.
  setMaxSegments(n: number): void {
    if (Number.isNaN(n)) return;
    this.maxSegments = Math.min(8, Math.max(1, Math.trunc(n)));
  }

  async add(url: string, saveDir: string): Promise<string> {
    assertHttpUrl(url); // a bad link must never reach the list
    await mkdir(this.options.stateDir, { recursive: true });
    const record = createRecord(url, saveDir);
    const entry = this.register(record);
    await saveRecord(entry.recordPath, record);
    await this.persistOrder();
    this.emit('changed', record);
    this.schedule();
    return record.id;
  }

  async pause(id: string): Promise<void> {
    const entry = this.get(id);
    if (entry.running) {
      await entry.download.pause();
      return;
    }
    if (entry.download.record.status === 'queued') {
      entry.download.record.status = 'paused';
      await saveRecord(entry.recordPath, entry.download.record);
      this.emit('changed', entry.download.record);
    }
  }

  async resume(id: string): Promise<void> {
    const entry = this.get(id);
    const record = entry.download.record;
    if (entry.running || (record.status !== 'paused' && record.status !== 'error')) return;
    record.status = 'queued';
    delete record.error;
    // Back of the line.
    this.entries.delete(id);
    this.entries.set(id, entry);
    await saveRecord(entry.recordPath, record);
    await this.persistOrder();
    this.emit('changed', record);
    this.emitReordered();
    this.schedule();
  }

  async moveUp(id: string): Promise<void> {
    await this.move(id, -1);
  }

  async moveDown(id: string): Promise<void> {
    await this.move(id, 1);
  }

  // Jump the line. With every slot taken, the newest running downloads (enough to leave a free slot) are paused and wait right behind this one, oldest first.
  async startNow(id: string): Promise<void> {
    const entry = this.get(id);
    const record = entry.download.record;
    if (entry.running || (record.status !== 'queued' && record.status !== 'paused' && record.status !== 'error')) return;
    const wasQueued = record.status === 'queued';
    record.status = 'queued';
    delete record.error;
    // First in line before anything can call schedule(), so the slot a pause frees goes to this one.
    this.setOrder([id, ...[...this.entries.keys()].filter((k) => k !== id)]);
    if (!wasQueued) {
      await saveRecord(entry.recordPath, record);
      this.emit('changed', record);
    }
    // A pause(id) that landed while the record was being saved wins: interrupt nothing for it.
    const victims = this.isWaiting(entry) ? this.newestRunningToFreeSlot() : [];
    if (victims.length > 0) {
      await Promise.all(victims.map(([, victimEntry]) => victimEntry.download.pause()));
      // One may have finished (or failed) before its pause landed; only a paused one goes back in line.
      const requeued = victims
        .reverse()
        .filter(([victimId, victimEntry]) => victimEntry.download.record.status === 'paused' && this.entries.get(victimId) === victimEntry);
      const front = [...(this.entries.has(id) ? [id] : []), ...requeued.map(([victimId]) => victimId)];
      for (const [, victimEntry] of requeued) victimEntry.download.record.status = 'queued';
      this.setOrder([...front, ...[...this.entries.keys()].filter((k) => !front.includes(k))]);
      for (const [, victimEntry] of requeued) {
        await saveRecord(victimEntry.recordPath, victimEntry.download.record);
        this.emit('changed', victimEntry.download.record);
      }
    }
    await this.persistOrder();
    this.emitReordered();
    this.schedule();
  }

  async cancel(id: string): Promise<void> {
    const entry = this.get(id);
    if (entry.running) await entry.download.pause();
    const { filename, saveDir } = entry.download.record;
    this.entries.delete(id);
    if (filename !== '') await rm(join(saveDir, `${filename}.part`), { force: true });
    await deleteRecord(entry.recordPath);
    await this.persistOrder();
    this.emit('removed', id);
    this.emitReordered();
    this.schedule();
  }

  async remove(id: string): Promise<void> {
    const entry = this.get(id);
    // A finished download is safe to remove even in the instant before its run wrapper clears `running`.
    if (entry.running && entry.download.record.status !== 'done') throw new Error('Pause or cancel a running download before removing it');
    this.entries.delete(id);
    await deleteRecord(entry.recordPath);
    await this.persistOrder();
    this.emit('removed', id);
    this.emitReordered();
  }

  // Pause everything that is running and stop scheduling, so quitting loses no progress. Safe to call twice.
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(
      [...this.entries.values()].filter((e) => e.running).map((e) => e.download.pause()),
    );
  }

  hasActive(): boolean {
    return [...this.entries.values()].some((e) => e.running);
  }

  list(): DownloadRecord[] {
    return [...this.entries.values()].map((e) => e.download.record);
  }

  // Crash recovery: nothing restarts by itself, and anything that was running comes back paused.
  async load(): Promise<void> {
    await mkdir(this.options.stateDir, { recursive: true });
    const names = (await readdir(this.options.stateDir)).filter((n) => n.endsWith('.json') && n !== ORDER_FILE).sort();
    const loaded: DownloadRecord[] = [];
    for (const name of names) {
      try {
        const record = await loadRecord(join(this.options.stateDir, name));
        if (record) loaded.push(record);
      } catch (err) {
        if (!(err instanceof CorruptRecordError)) throw err;
        this.emit('warning', `Skipped unreadable download record ${name}`);
      }
    }
    const saved = await this.readSavedOrder();
    const position = new Map<string, number>();
    for (const id of saved) if (!position.has(id)) position.set(id, position.size);
    // Saved line first; records the saved line does not know go after it, oldest first.
    loaded.sort((a, b) => {
      const pa = position.get(a.id);
      const pb = position.get(b.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
    for (const record of loaded) {
      if (record.status === 'downloading' || record.status === 'waiting' || record.status === 'queued') {
        record.status = 'paused';
      }
      if (record.status !== 'done' && (await this.partIsMissingOrWrong(record))) {
        for (const segment of record.segments) segment.downloaded = 0;
      }
      const entry = this.register(record);
      await saveRecord(entry.recordPath, record);
      this.emit('changed', record);
    }
    await this.persistOrder();
  }

  // ---- internals -----------------------------------------------------------

  private async readSavedOrder(): Promise<string[]> {
    try {
      return (await loadOrder(join(this.options.stateDir, ORDER_FILE))) ?? [];
    } catch (err) {
      if (!(err instanceof CorruptRecordError)) throw err;
      this.emit('warning', 'Skipped unreadable queue order');
      return [];
    }
  }

  private async persistOrder(): Promise<void> {
    try {
      await saveOrder(join(this.options.stateDir, ORDER_FILE), [...this.entries.keys()]);
    } catch (err) {
      this.emit('warning', `Could not save queue order: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Swaps a queued entry with the nearest queued entry in `step` direction; anything else is left alone.
  private async move(id: string, step: -1 | 1): Promise<void> {
    const entry = this.get(id);
    if (!this.isWaiting(entry)) return;
    const order = [...this.entries.keys()];
    const from = order.indexOf(id);
    let to = from + step;
    for (; to >= 0 && to < order.length; to += step) {
      const neighbour = this.entries.get(order[to] ?? '');
      if (neighbour && this.isWaiting(neighbour)) break;
    }
    const other = order[to];
    if (other === undefined) return;
    order[from] = other;
    order[to] = id;
    this.setOrder(order);
    await this.persistOrder();
    this.emitReordered();
  }

  private isWaiting(entry: Entry): boolean {
    return !entry.running && entry.download.record.status === 'queued';
  }

  // The newest running downloads, newest first, as many as it takes to leave one slot free (none when one is free already).
  private newestRunningToFreeSlot(): [string, Entry][] {
    const running = [...this.entries].filter(([, e]) => e.running);
    const count = Math.max(0, running.length - this.maxConcurrent + 1);
    return running.sort((x, y) => y[1].startedAt - x[1].startedAt).slice(0, count);
  }

  // Rebuilds the line (Map insertion order) in the given order of existing ids.
  private setOrder(ids: string[]): void {
    const byId = new Map(this.entries);
    this.entries.clear();
    for (const id of ids) {
      const entry = byId.get(id);
      if (entry) this.entries.set(id, entry);
    }
  }

  private emitReordered(): void {
    this.emit('reordered', [...this.entries.keys()]);
  }

  private async partIsMissingOrWrong(record: DownloadRecord): Promise<boolean> {
    if (record.filename === '') return false;
    try {
      const { size } = await stat(join(record.saveDir, `${record.filename}.part`));
      return record.size !== null && size !== record.size;
    } catch {
      return true;
    }
  }

  private get(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown download ${id}`);
    return entry;
  }

  private register(record: DownloadRecord): Entry {
    const recordPath = join(this.options.stateDir, `${record.id}.json`);
    const download = new Download(record, {
      maxSegments: this.maxSegments,
      ...this.options.downloadOptions,
      recordPath,
    });
    download.on('event', (event: EngineEvent) => {
      if (event.type === 'progress') this.emit('progress', record.id, event);
      else this.emit('changed', record);
    });
    const entry: Entry = { download, recordPath, running: false, startedAt: 0 };
    this.entries.set(record.id, entry);
    return entry;
  }

  private schedule(): void {
    if (this.shuttingDown) return;
    for (const entry of this.entries.values()) {
      const running = [...this.entries.values()].filter((e) => e.running).length;
      if (running >= this.maxConcurrent) return;
      if (entry.running || entry.download.record.status !== 'queued') continue;
      entry.running = true;
      entry.startedAt = ++this.starts;
      void entry.download.start().finally(() => {
        entry.running = false;
        this.schedule();
      });
    }
  }
}


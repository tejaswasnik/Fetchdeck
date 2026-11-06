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

type Entry = { download: Download; recordPath: string; running: boolean };

export class DownloadQueue extends EventEmitter {
  private readonly entries = new Map<string, Entry>(); // insertion order = line order
  private readonly maxConcurrent: number;
  private shuttingDown = false;

  constructor(private readonly options: QueueOptions) {
    super();
    this.maxConcurrent = options.maxConcurrent ?? 3;
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
      maxSegments: this.options.maxSegments,
      ...this.options.downloadOptions,
      recordPath,
    });
    download.on('event', (event: EngineEvent) => {
      if (event.type === 'progress') this.emit('progress', record.id, event);
      else this.emit('changed', record);
    });
    const entry: Entry = { download, recordPath, running: false };
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
      void entry.download.start().finally(() => {
        entry.running = false;
        this.schedule();
      });
    }
  }
}


export type SegmentState = { start: number; end: number; downloaded: number }; // end is inclusive

export type DownloadStatus = 'queued' | 'downloading' | 'waiting' | 'paused' | 'done' | 'error';

export type DownloadRecord = {
  id: string;
  url: string;
  finalUrl: string;
  filename: string;
  saveDir: string;
  size: number | null;
  etag: string | null;
  lastModified: string | null;
  rangeSupported: boolean;
  status: DownloadStatus;
  segments: SegmentState[];
  error?: string;
  createdAt: string;
};

export type ProbeResult = {
  finalUrl: string;
  size: number | null;
  rangeSupported: boolean;
  filename: string;
  etag: string | null;
  lastModified: string | null;
};

export type EngineEvent =
  | { type: 'progress'; bytesDone: number; speed: number; etaSeconds: number | null }
  | { type: 'status'; status: DownloadStatus; error?: string };

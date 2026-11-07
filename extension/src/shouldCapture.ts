export const DEFAULT_THRESHOLD_BYTES = 5 * 1024 * 1024;

export type CaptureSettings = { enabled: boolean; thresholdBytes: number };

/** The part of a browser download the extension reads. `totalBytes` is -1 while the size is unknown. */
export type DownloadItemLike = {
  id: number;
  url: string;
  referrer: string;
  filename: string;
  totalBytes: number;
  state: 'in_progress' | 'complete' | 'interrupted';
};

const isWebUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

// Anything this cannot hand over cleanly stays with the browser: unknown sizes, blob:/data: links that only the
// browser can read, and downloads that already finished.
export const shouldCapture = (item: DownloadItemLike, settings: CaptureSettings): boolean =>
  settings.enabled && item.state === 'in_progress' && isWebUrl(item.url) && item.totalBytes > 0 && item.totalBytes >= settings.thresholdBytes;

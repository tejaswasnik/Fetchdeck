import type { DownloadItemLike } from './shouldCapture';

export type CapturePayload = { url: string; cookie?: string; referer?: string; userAgent?: string; filename?: string; size?: number };

export type CaptureDeps = {
  getCookies(url: string): Promise<{ name: string; value: string }[]>;
  userAgent: string;
};

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? '';

// What the browser would send for this download, so a login-protected file works in Fetchdeck too.
export const buildCapture = async (deps: CaptureDeps, item: DownloadItemLike): Promise<CapturePayload> => {
  const cookies = await deps.getCookies(item.url);
  const name = baseName(item.filename);
  return {
    url: item.url,
    ...(cookies.length > 0 && { cookie: cookies.map(({ name: key, value }) => `${key}=${value}`).join('; ') }),
    ...(item.referrer !== '' && { referer: item.referrer }),
    userAgent: deps.userAgent,
    ...(name !== '' && { filename: name }),
    ...(item.totalBytes >= 0 && { size: item.totalBytes }),
  };
};

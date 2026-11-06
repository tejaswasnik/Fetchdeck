import type { DownloadView } from '../shared/api';

export type UpdateBatcher = {
  progress(view: DownloadView): void;
  status(view: DownloadView): void;
  stop(): void;
};

// Progress arrives many times a second per download; collapse it into one message per interval
// so the page is never flooded. Status changes are rare and matter, so they go out at once.
export const createUpdateBatcher = (send: (views: DownloadView[]) => void, intervalMs = 250): UpdateBatcher => {
  const pending = new Map<string, DownloadView>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending.size === 0) return;
    const views = [...pending.values()];
    pending.clear();
    send(views);
  };

  return {
    progress: (view) => {
      pending.set(view.id, view);
      timer ??= setTimeout(flush, intervalMs);
    },
    status: (view) => {
      pending.set(view.id, view);
      flush();
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
};

import { useCallback, useEffect, useState } from 'react';
import type { DownloadView } from '../shared/api';

const byPosition = (a: DownloadView, b: DownloadView): number => a.position - b.position;

export const useDownloads = () => {
  const [downloads, setDownloads] = useState<DownloadView[]>([]);

  const refresh = useCallback(async () => {
    setDownloads((await window.downloads.list()).sort(byPosition));
  }, []);

  useEffect(() => {
    // Subscribe first so nothing is missed, then load the initial list under any newer updates.
    const updated = new Set<string>();
    const unsubscribe = window.downloads.onUpdate((changed) => {
      changed.forEach((view) => updated.add(view.id));
      setDownloads((current) => {
        const merged = new Map(current.map((d) => [d.id, d]));
        changed.forEach((view) => merged.set(view.id, view));
        return [...merged.values()].sort(byPosition);
      });
    });
    void window.downloads.list().then((initial) => {
      setDownloads((current) => {
        const merged = new Map(initial.map((d) => [d.id, d]));
        current.filter((d) => updated.has(d.id)).forEach((d) => merged.set(d.id, d));
        return [...merged.values()].sort(byPosition);
      });
    });
    return unsubscribe;
  }, []);

  const actions = {
    add: (url: string) => window.downloads.add(url),
    pause: (id: string) => window.downloads.pause(id),
    resume: (id: string) => window.downloads.resume(id),
    cancel: (id: string) => window.downloads.cancel(id).then(refresh),
    remove: (id: string) => window.downloads.remove(id).then(refresh),
    moveUp: (id: string) => window.downloads.moveUp(id),
    moveDown: (id: string) => window.downloads.moveDown(id),
    startNow: (id: string) => window.downloads.startNow(id),
    openFile: (id: string) => window.downloads.openFile(id),
    showInFolder: (id: string) => window.downloads.showInFolder(id),
    removeAndDelete: (id: string) => window.downloads.removeAndDelete(id).then(refresh),
  };

  return { downloads, actions };
};

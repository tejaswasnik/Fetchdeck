import { buildCapture } from './buildCapture';
import type { ChromeLike } from './chromeLike';
import type { FetchdeckClient } from './fetchdeckClient';
import { isWebUrl, shouldCapture, type CaptureSettings, type DownloadItemLike } from './shouldCapture';

type Deps = {
  chrome: ChromeLike;
  client: FetchdeckClient;
  getSettings(): Promise<CaptureSettings>;
  userAgent: string;
};

export type CaptureController = {
  onDownloadCreated(item: DownloadItemLike): Promise<void>;
  onLinkClicked(info: { linkUrl: string; pageUrl?: string }): Promise<void>;
  /** Resumes every browser download an earlier service worker left paused. Call once when the worker starts. */
  recover(): Promise<void>;
};

const IN_FLIGHT_KEY = 'inFlight';
const BYPASS_MS = 30_000;

const asIds = (value: unknown): number[] => (Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : []);

// The rule this file keeps: a browser download this controller paused is always either handed to Fetchdeck
// (cancelled and erased) or resumed. Nothing is ever left paused.
export const createCaptureController = (deps: Deps): CaptureController => {
  const { chrome, client, getSettings, userAgent } = deps;
  const session = chrome.storage.session;
  const handled = new Set<number>();
  const bypass = new Map<string, number>(); // link -> when the pass expires
  let writes: Promise<unknown> = Promise.resolve();

  // Several downloads can be waiting at once, so changes to the stored list happen one after another.
  const changeInFlight = (change: (ids: number[]) => number[]): Promise<void> => {
    const done = writes.then(async () => {
      const updated = change(asIds((await session.get(IN_FLIGHT_KEY))[IN_FLIGHT_KEY]));
      if (updated.length === 0) await session.remove(IN_FLIGHT_KEY);
      else await session.set({ [IN_FLIGHT_KEY]: updated });
    });
    writes = done.catch(() => undefined);
    return done;
  };
  const remember = (id: number): Promise<void> => changeInFlight((ids) => [...ids, id]).catch(() => undefined);
  const forget = (id: number): Promise<void> => changeInFlight((ids) => ids.filter((other) => other !== id)).catch(() => undefined);

  const resume = async (id: number): Promise<void> => {
    try {
      await chrome.downloads.resume(id);
    } catch {
      // The download is gone (the person cancelled it), so there is nothing left to resume.
    }
  };

  const captureLink = (url: string, referrer: string) =>
    buildCapture({ getCookies: (target) => chrome.cookies.getAll({ url: target }), userAgent }, {
      id: -1, url, referrer, filename: '', totalBytes: -1, state: 'in_progress',
    });

  const key = (url: string): string => new URL(url).href;
  const consumeBypass = (url: string): boolean => {
    if (!isWebUrl(url)) return false;
    const expires = bypass.get(key(url));
    bypass.delete(key(url));
    return expires !== undefined && expires > Date.now();
  };

  return {
    async onDownloadCreated(item) {
      // The browser download we started ourselves as a fallback must not be captured again.
      if (consumeBypass(item.url)) return;
      const settings = await getSettings();
      // Checking and marking happen in one step, so a download delivered twice is handled once.
      if (!shouldCapture(item, settings) || handled.has(item.id)) return;
      handled.add(item.id);

      try {
        await chrome.downloads.pause(item.id);
      } catch {
        return; // it finished (or was cancelled) before it could be paused: leave it entirely alone
      }
      await remember(item.id);
      try {
        const { captureId } = await client.postCapture(await buildCapture(
          { getCookies: (url) => chrome.cookies.getAll({ url }), userAgent },
          item,
        ));
        if ((await client.waitForOutcome(captureId)) === 'accepted') {
          try {
            await chrome.downloads.cancel(item.id);
            await chrome.downloads.erase({ id: item.id });
          } catch {
            // Fetchdeck has the download. Resuming here would download it twice.
          }
          return;
        }
        await resume(item.id);
      } catch {
        await resume(item.id); // app down, wrong token, refused, polls failed, cookies unreadable
      } finally {
        await forget(item.id);
      }
    },

    async onLinkClicked({ linkUrl, pageUrl }) {
      if (!isWebUrl(linkUrl)) return;
      try {
        const { captureId } = await client.postCapture(await captureLink(linkUrl, pageUrl ?? ''));
        if ((await client.waitForOutcome(captureId)) === 'accepted') return;
      } catch {
        // fall through: the link goes to the browser
      }
      bypass.set(key(linkUrl), Date.now() + BYPASS_MS);
      try {
        await chrome.downloads.download({ url: linkUrl });
      } catch {
        bypass.delete(key(linkUrl));
      }
    },

    async recover() {
      const waiting = asIds((await session.get(IN_FLIGHT_KEY))[IN_FLIGHT_KEY]).filter((id) => !handled.has(id));
      await Promise.all(waiting.map(resume));
      await changeInFlight((ids) => ids.filter((id) => !waiting.includes(id)));
    },
  };
};

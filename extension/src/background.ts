import type { ChromeLike } from './chromeLike';
import { createCaptureController } from './controller';
import { ClientError, DEFAULT_BASE_URL, createFetchdeckClient } from './fetchdeckClient';
import { loadSettings } from './settings';

const MENU_ID = 'fetchdeck-download-link';
const browser: ChromeLike = chrome;

const client = createFetchdeckClient({
  baseUrl: DEFAULT_BASE_URL,
  getToken: async () => {
    const { token } = await loadSettings(chrome.storage.local);
    // Not paired yet: say so without bothering the app, which counts every wrong token against its lockout.
    if (token === '') throw new ClientError('wrong-token', 'Paste the pairing token in the extension options first.');
    return token;
  },
});

const controller = createCaptureController({
  chrome: browser,
  client,
  userAgent: navigator.userAgent,
  // Until it is paired the extension leaves every download to the browser, instead of pausing it for nothing.
  getSettings: async () => {
    const { enabled, thresholdBytes, token } = await loadSettings(chrome.storage.local);
    return { enabled: enabled && token !== '', thresholdBytes };
  },
});

const updateBadge = async (): Promise<void> => {
  const { enabled } = await loadSettings(chrome.storage.local);
  await browser.action.setBadgeText({ text: enabled ? '' : 'off' });
};

browser.downloads.onCreated.addListener((item) => void controller.onDownloadCreated(item));
browser.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID && info.linkUrl) void controller.onLinkClicked({ linkUrl: info.linkUrl, pageUrl: info.pageUrl });
});
browser.runtime.onInstalled.addListener(() => {
  void browser.contextMenus.removeAll().then(() => browser.contextMenus.create({ id: MENU_ID, title: 'Download with Fetchdeck', contexts: ['link'] }));
  void updateBadge();
});
browser.runtime.onStartup.addListener(() => void updateBadge());
chrome.storage.onChanged.addListener(() => void updateBadge());

// Every time the service worker starts, anything an earlier worker left paused goes back to the browser.
void controller.recover();
void updateBadge();

# Browser extension spike, 2026-11-07

Throwaway code (not in the repo): a Manifest V3 extension with only the `downloads` permission, loaded into Chromium through Playwright, against a local server that sends a 6 MiB file at about 3 MB/s and a `/hold` endpoint that answers after N seconds.

## Questions and answers

1. **Can a download be paused from `chrome.downloads.onCreated`?** Yes. `chrome.downloads.pause(id)` succeeded inside the handler for a download that was `in_progress` with `totalBytes` known; `search` then reported `paused: true`. `cancel` followed by `erase` worked.
2. **Does a 20 second long-poll keep the service worker alive?** Yes. Three polls in a row (60 s in total, `GET /hold?wait=20`) all completed in the same service worker (the boot id never changed). `POLL_WAIT_SECONDS` stays at **20**; no need for the 2 s fallback.
3. **Does `resume` after a long pause finish the file?** Yes. After 60 s paused, `resume` completed the download: 6291456 bytes, the full size.

## Launch recipe for the Chromium e2e test (Task 11)

```js
const { chromium } = createRequire(import.meta.url)('playwright');
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',          // full Chromium in new headless mode; the default headless shell cannot load extensions
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
```

- Do **not** pass `acceptDownloads: false`. Playwright then cancels every download itself and `pause` fails with "Download must be in progress".
- To watch the outcome use `page.waitForEvent('download')`, then `download.path()`.

## Risks seen

- While a download is paused, the browser keeps the connection to the origin server open. A real server may close an idle connection; Chrome then resumes with a `Range` request if the server allows it, otherwise the download fails. The extension only pauses for as long as it takes the user to answer the dialog, and resumes on any failure, so this stays a known limit (README).
- This ran in Chromium, not Edge or a normal Chrome profile; the manual checklist still covers those.

## Baseline before any change

`npm run check` on `fix/v1.1.1` (Linux copy, Node 22.23): 26 test files, 348 tests, all passing, about 41 s.

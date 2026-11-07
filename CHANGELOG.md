# Changelog

## 1.2.0 - 2026-11-07

- Browser extension for Chrome and Edge: large downloads (5 MB or more by default) are paused in the browser and offered to Fetchdeck in its Add dialog, and any link can be sent from the right-click menu ("Download with Fetchdeck"). **Download in browser** lets the browser carry on. Load it unpacked from `extension/dist` or from `Fetchdeck-Extension-1.2.0.zip` on the release page.
- Downloads that need a login: the extension passes the site's cookies, the Referer and the User-Agent. The engine sends the cookies only to the site they belong to. They are encrypted on disk with the system keyring, and deleted when the download finishes, is cancelled or is removed.
- Settings has a Browser extension section: a switch (off by default) that starts or stops a local server on `127.0.0.1:47600`, its status, and the pairing token with Show, Copy and Regenerate.
- The local server accepts only the extension: it checks the Host, the Origin and a secret token, limits request size and locks out repeated wrong tokens for a minute.

## 1.1.1 - 2026-11-07

- The Settings button could be off-screen on small or scaled displays: the window now opens no larger than the screen's usable area, and on a short window the sidebar list scrolls while Settings stays pinned at the bottom.

## 1.1.0 - 2026-11-07

- Settings: choose the save folder, how many downloads run at once (1 to 6), how many connections each download uses (1 to 8), and turn notifications on or off.
- Queue reordering: Move up and Move down in the row menu, or Alt+Up and Alt+Down; the order is kept across restarts. Start now in the row menu puts a queued download first and starts it at once.
- Notifications when a download finishes or fails while the window is not in focus; clicking one shows the file or brings the app forward.
- Building from source now needs Node 22.12 or newer (the test tools no longer support Node 20). The installers are not affected.

## 1.0.0 - 2026-11-06

- Fixed the Fetchdeck logo not showing in the app: the page's security policy blocked the inlined logo image.
- Linux builds (AppImage, deb) now work: the executable name is set explicitly.

## 0.1.1 - 2026-11-06

- Clean shutdown: quitting pauses running downloads and saves their progress; closing the window with active downloads asks first.
- Only one instance of the desktop app runs at a time; a second launch focuses the open window.
- Download records are validated when loaded, saved one at a time per file, and synced to disk before the rename.
- Recovery: queued, waiting and downloading records all load as paused (documented in DECISIONS.md).
- Two downloads of the same file name can no longer pick the same name: the name is claimed atomically.
- Finishing a download retries Windows' transient file-lock errors (antivirus, indexers) before reporting a clear error.
- The main process now validates every argument it receives from the page.
- README lists what is not in v1; removed the disabled Settings button and the "No speed limit" label from the UI.
- Docs: design spec and build guide live in docs/; removed a placeholder test.
- CI: runs on pushes to main and pull requests, cancels superseded runs, and launches the built app (`--smoke`) on Windows and Linux. The release workflow checks once, creates the release from this changelog, and attaches installers and SHA-256 checksums.
- A download can be removed in the instant it finishes (it was sometimes refused).

## 0.1.0 - 2026-11-06

- Download engine: parallel range requests, pause/resume, retries with backoff, single-stream fallback, work stealing.
- Queue with 3 concurrent downloads and crash recovery.
- `dl` command-line tool.
- Electron + React desktop app, with a redesigned UI: custom title bar, sidebar filters, details panel, add-download dialog with link preview, and a row menu.
- Windows installer (NSIS, unsigned).
- Not included in this version: speed limiting, queue reordering, a settings screen, a first-run screen, per-connection speeds, scheduling, checksums, a browser extension.

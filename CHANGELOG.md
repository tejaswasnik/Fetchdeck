# Changelog

## 0.1.0 (unreleased)

- Download engine: parallel range requests, pause/resume, retries with backoff, single-stream fallback, work stealing.
- Queue with 3 concurrent downloads and crash recovery.
- `dl` command-line tool.
- Electron + React desktop app.
- Clean shutdown: quitting pauses running downloads and saves their progress; closing the window with active downloads asks first.
- Only one instance of the desktop app runs at a time; a second launch focuses the open window.
- Download records are validated when loaded, saved one at a time per file, and synced to disk before the rename.
- Recovery: queued, waiting and downloading records all load as paused (documented in DECISIONS.md).
- Two downloads of the same file name can no longer pick the same name: the name is claimed atomically.
- Finishing a download retries Windows' transient file-lock errors (antivirus, indexers) before reporting a clear error.
- The main process now validates every argument it receives from the page.
- README lists what is not in v1; removed the disabled Settings button and the "No speed limit" label from the UI.

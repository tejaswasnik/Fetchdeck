# Changelog

## 0.1.0 (unreleased)

- Download engine: parallel range requests, pause/resume, retries with backoff, single-stream fallback, work stealing.
- Queue with 3 concurrent downloads and crash recovery.
- `dl` command-line tool.
- Electron + React desktop app.
- Clean shutdown: quitting pauses running downloads and saves their progress; closing the window with active downloads asks first.
- Only one instance of the desktop app runs at a time; a second launch focuses the open window.

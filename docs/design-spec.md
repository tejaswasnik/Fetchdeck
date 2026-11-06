# Download Manager (IDM-style) — Design Spec

Date: 2026-10-23
Author: Tejas Wasnik (with Claude)
Status: Draft, awaiting review

## 1. Purpose and success criteria

**Goal.** A desktop download manager in the spirit of IDM that serves three purposes at once:
1. A polished portfolio and placement showpiece.
2. A tool used daily for plain file downloads.
3. A hands-on way to learn networking and concurrency.

**Success looks like:**
- A large file downloads noticeably faster than a single connection when the server limits per-connection speed.
- A download resumes correctly after a crash, restart, or pause, and the final file is byte-for-byte identical to the original.
- A clean UI, a README with an architecture diagram and benchmark numbers, and a short demo for recruiters.

**Decisions made:**
- Stack: Electron + React (Vite) + TypeScript, engine in Node. Tests with Vitest.
- The segment engine is written from scratch (no download libraries); that is the learning and showcase part.
- Downloads are started by pasting a URL first; a browser extension comes after the core works.

## 2. Scope

**In v1:**
- Segmented parallel downloads (up to 8 pieces), pause, resume, retry
- Queue with a concurrency limit, progress, speed and ETA
- Crash recovery from on-disk state
- Electron + React UI
- Test suite and CI

**Out of v1 (design must not block them, but nothing is built for them):**
- Browser extension and native link interception (planned as the step after v1)
- Speed limiting, scheduling, checksum verification, video grabbing, site logins, a database

## 3. Findings from the feasibility spike

Verified with throwaway scripts (a local fake server and a script run against real URLs). These findings drive the design:

- Range support is confirmed by actually requesting `Range: bytes=0-N` and getting `206`. The `Accept-Ranges` header alone is only a hint.
- Parallel segments written at offsets into one pre-sized file reassemble byte-identically (SHA-256 verified for 1, 4 and 8 segments). The last segment absorbs any remainder.
- On a per-connection-throttled server, 4 segments were about 4x faster than 1. With no throttle (local), there was no difference.
- A dropped connection is detectable and must be treated as a normal event.
- Redirects must be followed explicitly. GitHub release links redirect to a signed URL on another host that expires in roughly an hour, so resume must re-resolve the original URL.
- `Content-Disposition` provides the filename on GitHub but not on nodejs.org, so filename detection needs a fallback chain.
- Not yet verified: per-IP connection caps, sites needing login cookies, wrong `Content-Length` values. These are covered by hardening work, not v1 design.

## 4. Architecture

Four pieces with one-way dependencies: renderer → main → queue → engine. The engine knows nothing about the others.

1. **`engine/`** — plain Node library, no Electron, no UI. Given a URL, it probes the server, plans segments, downloads in parallel, retries failures, and emits events. It is usable from a CLI and tested on its own.
2. **`queue/`** — holds the download list, enforces the concurrency limit, and persists state to disk for crash recovery.
3. **`app/main`** — Electron main process. Wires engine and queue together and exposes commands to the UI over IPC.
4. **`app/renderer`** — React UI. Displays state and sends commands. Contains no download logic.

The engine runs inside the Electron main process behind a clean interface. If the UI ever lags it can be moved to a separate process without changing callers.

Repository layout (monorepo): `engine/`, `queue/`, `app/`, later `extension/`.

## 5. Engine internals

### 5.1 Download flow
1. **Probe.** Send `Range: bytes=0-0`, following redirects. Record: final URL, total size (from `Content-Range`), whether `206` was returned, filename, `ETag`, `Last-Modified`.
2. **Plan.** Split into up to 8 segments with a minimum segment size of about 1 MB, so small files are not chopped up. The last segment absorbs the remainder.
3. **Download.** Each segment requests its own byte range and writes at its own offset into a pre-sized `<name>.part` file. Each segment tracks bytes completed.
4. **Retry.** A failed or dropped segment retries from the byte where it stopped, with backoff (1s, 2s, 4s, ...), up to 5 attempts; then the download is marked as errored. Each segment must receive exactly the bytes expected; a short segment counts as a failure.
5. **Finish.** When every segment is complete, rename `<name>.part` to the final filename.

### 5.2 Resume
On resume, the engine re-probes the original URL (which also yields a fresh signed link where applicable). If the total size or `ETag` differs from the saved values, the file changed on the server and the download restarts from zero. Otherwise it continues from the saved segment offsets.

### 5.3 Fallback
If the probe does not return `206`, the file is downloaded as a single stream. Such a download cannot be resumed; pausing means restarting, and the UI says so.

### 5.4 Filename
Order of preference: `Content-Disposition` filename, then the last path segment of the final URL, then the last path segment of the original URL. If a file with that name already exists in the save folder, use `name (1).ext`, `name (2).ext`, and so on.

### 5.5 Events
The engine emits progress (bytes done, speed, ETA), status changes, and errors. Speed and ETA are smoothed over a few seconds to avoid jumping values.

### 5.6 Cancellation
All network requests use an `AbortController`, so pause and cancel stop work promptly.

## 6. Data model

One small JSON file per download, written to a temporary file and then renamed, so a crash cannot leave a corrupted file:

```
{
  id, url, finalUrl, filename, saveDir,
  size, etag, lastModified, rangeSupported,
  status: queued | downloading | waiting | paused | done | error,
  segments: [{ start, end, downloaded }],
  error?, createdAt
}
```

`waiting` means the network is unavailable and the engine is retrying with growing waits. `error` holds a plain-language message and may be set on a `paused` download too (for example, a disk-full pause).

`url` is the original link the user gave; `finalUrl` is only a cache of the last resolved link and is replaced on every resume.

## 7. Queue and crash recovery

### 7.1 Queue
- Up to 3 downloads run at once (configurable); each uses up to 8 segments.
- First added starts first. When a download finishes, fails, or is paused, the next waiting one starts.

### 7.2 Persistence ordering
- While downloading, progress is saved about once per second, and on pause and app exit.
- File data is flushed before the progress note is written, so the note never claims more than what is on disk.

### 7.3 Recovery on startup
- Any download found in the `downloading` state is set to `paused`; the user clicks Resume. Nothing restarts automatically.
- If the `.part` file is missing or has the wrong size, that download restarts from zero.

## 8. UI and IPC

- Commands from the UI: add (URL), pause, resume, cancel, remove, list.
- The main process owns the real state; the renderer holds a copy updated from events.
- Status changes are sent immediately. Progress updates are batched to about 4 per second per download so the UI stays responsive.
- The renderer has no direct file or network access. It uses a small preload bridge (`contextBridge`) exposing only the commands above, with context isolation on and Node integration off.
- Errors appear on the download row in plain language (for example "Server refused the connection", "Disk full") with a Retry button.

## 9. Error handling

| Situation | Behavior |
|---|---|
| Connection drops | Retry that segment from where it stopped |
| Link expired (403/410) | Re-probe the original URL, continue with the fresh link |
| File changed on the server | Restart from zero |
| No range support | Single-stream download, marked as non-resumable |
| Server says slow down (429/503) | Wait (honor `Retry-After` if sent, otherwise back off), then allow fewer segments to run at the same time for that download; the rest wait their turn |
| No internet | Status becomes `waiting`; retry with growing waits until the network returns or the user pauses |
| Disk full | Pause and show a clear message |
| Bad link or 404 | Fail immediately, no retries |
| Filename already exists | Save as `name (1).ext` |

## 10. Testing

- **Unit tests:** segment planning (odd sizes, tiny files), filename selection, speed and ETA smoothing.
- **Fake-server integration tests:** a local server that can behave normally, ignore ranges, drop connections, be slow, redirect, expire a link after a few seconds, and change the file mid-download. The engine must handle each.
- **Crash test (most important):** start a download in a child process, kill it abruptly, restart, resume, and verify the SHA-256 of the result equals the original.
- **UI tests:** component tests for the download list; one end-to-end smoke test of the app later.
- **CI:** GitHub Actions runs lint, type-check, and all tests on every push.

## 11. Build order (implementation plan will detail this)

1. Repo, TypeScript, lint, Vitest, CI
2. Engine as a library, test-first, driven from a CLI (`dl <url>`)
3. Queue and persistence, including the crash test
4. Electron + React UI
5. Hardening on real downloads
6. Browser extension
7. Packaging (Windows installer, Linux AppImage/deb) and a GitHub Release
8. README, benchmarks, demo

## 12. Open questions

None blocking v1. To revisit after v1: how the extension hands off cookies and headers for authenticated links, and whether the engine should move to its own process.

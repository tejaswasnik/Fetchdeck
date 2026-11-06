# Decisions

**Write each segment at its own offset into one pre-sized `.part` file.** Segments never touch each other's bytes, so concurrent writes through one file handle are safe and there is no merge step at the end.

**Verify range support with a real request.** `probe` sends `Range: bytes=0-0` and trusts only a `206`, not the `Accept-Ranges` header. Servers that say yes and answer `200` fall back to a single stream, including mid-download.

**Send `Accept-Encoding: identity` on every request.** Otherwise `fetch` may transparently gunzip and the byte counts stop matching `Content-Length`.

**Check ETag and size before resuming.** A changed file restarts from zero instead of splicing two versions together. Segments also send `If-Range`, so a change mid-download is caught by the server.

**`fsync` the file, then save the record.** The record must never claim bytes that did not reach the disk. Records are written to `.tmp` and renamed, so a crash leaves the old record whole.

**Sanitize server-supplied filenames.** A server controls `Content-Disposition`; without this, `../../x` writes outside the download folder.

**Work stealing shortens the victim in place.** The running `runSegment` re-reads `segment.end` on every chunk, so no extra signalling is needed and `record.segments` simply grows, which keeps resume trivial.

**Retry policy lives in a pure `classifyFailure`.** Network errors retry forever with capped backoff, server errors give up after 5 attempts and halve concurrency, expired links re-probe once, and `ENOSPC` pauses instead of failing.

**The engine has no UI dependency.** The CLI and the Electron app drive the same `Download` and `DownloadQueue`.

**Electron bundles the workspace packages.** `@fetchdeck/engine` and `@fetchdeck/queue` are TypeScript source, so electron-vite inlines them into the main bundle rather than leaving them as external imports.

**The renderer has no Node access.** `contextIsolation`, `sandbox` and a narrow preload bridge (`window.downloads`). Progress updates are batched to one message per 250 ms.

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

**On load, `queued` and `waiting` come back `paused`, not just `downloading`.** The design spec (7.3) only names `downloading`, but a `queued` record would start the moment the app opens and a `waiting` one was mid-retry when the app died. Nothing restarts without the user pressing Resume, so a crash or quit never starts a surprise download.

**Queue order lives in `order.json`, not on the record.** Moving one download would otherwise rewrite many records, and a crash halfway would leave two downloads with the same position. One small file written temp-then-rename holds the whole line; on load, unknown or repeated ids are ignored and records it omits go last by `createdAt`.

**Settings: folder and connections apply to new downloads; the limit applies live.** A running download keeps the folder and connection count it started with, so changing them never moves or restarts a file. The simultaneous-downloads limit applies at once but never stops a running download; it only decides what starts next.

**Start now can pause more than one download when the limit was lowered below the running count.** If the simultaneous limit was lowered while more downloads were running than it allows, Start now pauses enough of them to free a slot for the chosen one, which can be more than one; the paused ones are requeued behind the chosen download.

**The extension talks to the app through a local server, not native messaging.** Native messaging needs a registered host manifest on every machine and a different registration on Windows and Linux. A server bound to `127.0.0.1:47600` with a pairing token works the same everywhere, can be switched off in Settings, and is easy to test with real HTTP. The cost is a fixed port: if another program holds it, the server stays off and Settings says so.

**The extension pauses a browser download, then cancels it only after Fetchdeck accepts.** Cancelling first would lose the download if the app were closed or the user said "Download in browser". Pausing keeps the browser's copy intact, so every failure path (app closed, wrong token, dialog dismissed, no answer) ends with `resume`. The cost is that a very small file can finish before it is paused; then the extension leaves it alone.

**Cookies are encrypted on disk and deleted when no longer needed.** They are kept in `<id>.auth` files written through Electron safeStorage, never in the download record. They are deleted when a download finishes, is cancelled or is removed, and kept after an error so Retry works. Credential files without a record are deleted on load. With no keyring, they live in memory only and nothing is written unencrypted.

**Cookies go only to the origin of the original URL, and the engine enforces it.** Node drops `Cookie` when a redirect crosses origins, but segment requests go straight to the redirected address, so without a rule of its own the cookie would reach the CDN on every segment. One engine function filters the headers by the target origin; the other sites get Referer and User-Agent only.

**Alt-to-bypass was dropped.** It needs a content script on every page to see the key. The toolbar switch and the dialog's Download in browser cover the same need without that permission.

**The local server checks Origin before the token.** A hostile web page can send requests to localhost; if wrong tokens counted against the lockout it could lock the real extension out. Requests with a foreign Origin are refused first and never count.

**The page holds capture ids, never cookies.** The renderer sees `{ captureId, url, filename, size }`. Main looks up the headers when the user accepts or when the preview runs, so a compromised page cannot read credentials. The filename the browser suggested is not passed on either; the engine names the file from the response.

**If the browser stops the extension mid-wait, recovery waits for its next start.** In-flight capture ids are kept in `chrome.storage.session`; on startup the extension resumes any download it paused that no running worker owns. Nothing can resume the download before the extension runs again, and a download the user already confirmed in that gap is fetched twice. Resuming from outside the extension was judged more complex than this rare case warrants.

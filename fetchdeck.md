# Download Manager V1: Build-It-Yourself Guide

**What you're building:** an IDM-style desktop download manager. It downloads files in parallel pieces, supports pause, resume and a queue, and recovers after a crash. It's an Electron + React app with an engine written from scratch in Node.

**Design reference:** `docs/superpowers/specs/2026-10-23-download-manager-design.md` (the spec). This guide tells you *how* to build it. The spec says *what* it must do. When they seem to disagree, the spec wins.

**Not in V1:** the browser extension, speed limiting, scheduling, checksums, auto speed-up.

---

## 1. How to use this guide

- The work is split into **9 phases**. Each phase ends with something that works and that you can show someone.
- Each phase starts with **Learn first**: the new topics you need, and how deep to go. Learn them just before the phase, not all up front.
- Each step is a checkbox. Tick it when its **Check** passes.
- The guide gives **names, signatures and test cases**, not code. Signatures matter because later phases depend on them, so keep the names exactly as written. The function bodies are yours to write.
- **Hints** point the way without solving the step. Use them only once you're stuck.
- You already have two working references from the spike: `server.js` (a fake server) and `realworld.js`. Try each step yourself first, then compare with them.

## 2. Timeline

At about **12-15 hours a week** (weekday evenings plus weekends), V1 takes about **11-12 weeks**:

| Phase | What | Weeks |
|---|---|---|
| 0 | Project setup and CI | 1 |
| 1 | Learn HTTP and files by hand, build the fake server | 1-2 |
| 2 | Pure building blocks (test-first) | 2-3 |
| 3 | Talking to servers | 3-4 |
| 4 | The Download class (the core) | 4-7 |
| 5 | Command-line tool (first usable version) | 7 |
| 6 | Queue and crash recovery | 8 |
| 7 | Desktop app (Electron + React) | 9-10 |
| 8 | Ship: installers, real-world testing, README | 11-12 |

Every phase ends at a clean stopping point, so you can pause for exams and pick up where you left off. Phase 4 is the longest and hardest, and that's normal.

## 3. Learning curve

What you already have: JavaScript, async/await, Node and Express, React, REST APIs, Git basics. What's new is lower-level Node, HTTP details, testing, and Electron.

| Topic | Starting point (guessed) | How deep for V1 | Needed in | Where to learn |
|---|---|---|---|---|
| TypeScript | Some exposure | Everyday types, unions, type aliases, narrowing, `strict` mode. Skip generics-heavy material | Phase 0 onward | [TS Handbook](https://www.typescriptlang.org/docs/handbook/intro.html): "Everyday Types" and "Narrowing" |
| Testing with Vitest + test-first | Probably new | `describe`, `it`, `expect`, async tests, running one file, spies (`vi.fn`) | Phase 0 onward | [Vitest guide](https://vitest.dev/guide/) |
| HTTP in depth | Know basics from APIs | Range requests, 200 vs 206 vs 416, redirects, `Content-Length`, `Content-Range`, `ETag`, `If-Range`, `Content-Disposition`, `Retry-After` | Phase 1 | [MDN Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests), [MDN status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status), [MDN Content-Disposition](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition) |
| Bytes in Node | Likely new | `Buffer` / `Uint8Array`, `subarray`, byte lengths, hashing with `crypto` | Phase 1 | [Node Buffer docs](https://nodejs.org/api/buffer.html) |
| Low-level file I/O | New | `fs/promises` `FileHandle`: `open`, `write` at a position, `truncate`, `sync`, `close`; `rename` | Phase 1 | [Node fs promises API](https://nodejs.org/api/fs.html#promises-api) |
| `fetch` as a stream | Used `fetch`, not streams | Reading `response.body` chunk by chunk with `getReader()`, cancelling a body | Phase 1 | [MDN Using readable streams](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_streams) |
| Cancellation | New | `AbortController` and `AbortSignal`, `AbortError` | Phase 1 | [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) |
| Events | Used `.on()` | Writing a class that extends `EventEmitter` | Phase 1 | [Node events](https://nodejs.org/api/events.html) |
| Async concurrency | Know `await` | `Promise.all` and what it does on failure, running many tasks at once, avoiding races on shared state | Phase 4 | Practise in Phase 1 exercises |
| Node `http` server | Know Express | Plain `http.createServer`, raw headers, destroying a socket | Phase 1 (fake server) | [Node http](https://nodejs.org/api/http.html) |
| Child processes | New | `fork` / `spawn`, sending messages, killing with `SIGKILL` | Phase 5-6 | [Node child_process](https://nodejs.org/api/child_process.html) |
| GitHub Actions | Probably new | One workflow file: install, lint, test, on two OSes | Phase 0, 8 | [GitHub Actions docs](https://docs.github.com/en/actions) |
| Electron | New | Main vs renderer process, IPC, preload with `contextBridge`, security defaults | Phase 7 | [Process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [IPC](https://www.electronjs.org/docs/latest/tutorial/ipc), [Security](https://www.electronjs.org/docs/latest/tutorial/security) |
| Electron tooling | New | electron-vite for dev setup, electron-builder for installers | Phase 7-8 | [electron-vite](https://electron-vite.org/), [electron-builder](https://www.electron.build/) |

**Link to your OS subject:** file descriptors, `fsync` and the page cache (Phase 4), processes and signals like `SIGKILL` (Phase 6). This project is a practical run-through of that syllabus.

## 4. Ground rules for working

1. **The test-first loop**, used from Phase 2 on:
   1. Write one failing test.
   2. Run it and watch it fail, so you know the test actually checks something.
   3. Write the smallest code that passes it.
   4. Run it and watch it pass.
   5. Clean up the code with the tests still passing.
   6. Commit.
2. **One Git branch per phase**, merged through a pull request into `main` (even working alone). CI must be green before you merge.
3. **Small commits** with clear messages, like `feat(engine): segment planner`.
4. **Keep `DECISIONS.md`.** Every time you choose between two ways of doing something, write two lines on what you chose and why. This becomes your interview material.
5. **Run `npm run check` before every push.** It runs lint, type-check and all tests.

### When you get stuck

1. Re-read the step and its hint.
2. Read the docs for the exact function you're using.
3. Make a 10-line experiment in `playground/` that isolates the problem.
4. Add `console.log` at each stage and compare what you expected with what happened.
5. Only then ask someone, and ask for an *explanation*, not code.

---

## Phase 0: Project setup and CI (Week 1, about 6 hours)

**Goal:** an empty project where `npm run check` passes locally and on GitHub for Windows and Linux.

**Learn first:** TS everyday types, Vitest basics, what a GitHub Actions workflow is.

- [x] **0.1 Create the repo.** New GitHub repo `download-manager`, clone it. `.gitignore`: `node_modules`, `dist`, `out`, `release`, `*.part`, `playground/downloads`.
  - **Check:** first commit pushed.
- [x] **0.2 Root `package.json`.** `"private": true`, `"type": "module"`, `"workspaces": ["engine"]`. Add `queue` and `app` later, when you reach them.
  - Dev dependencies at the root: `typescript`, `vitest`, `tsx`, `@types/node`, `eslint`, `typescript-eslint`.
  - **Check:** `npm install` creates one `node_modules` at the root.
- [x] **0.3 `engine/package.json`.** Name it `@dl/engine`, with `"type": "module"` and `"main": "src/index.ts"`.
  - **Check:** `npm ls @dl/engine` shows it linked.
- [x] **0.4 TypeScript config.**
  - `tsconfig.base.json`: `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `noEmit: true`, `skipLibCheck: true`.
  - `engine/tsconfig.json`: extends the base and includes `src`, `test`, `cli`.
  - **Hint:** `noEmit` means you never compile to JS yourself. `tsx`, Vitest and electron-vite all run TS directly, and `tsc` is used only to check types. This avoids a lot of setup pain.
  - **Check:** `npx tsc -p engine` exits with no output.
- [x] **0.5 ESLint.** `eslint.config.js` using `typescript-eslint`'s recommended config.
  - **Check:** `npx eslint .` runs clean.
- [x] **0.6 Scripts in root `package.json`:**
  - `lint`: `eslint .`
  - `typecheck`: `tsc -p engine` (add more `-p` runs as packages arrive)
  - `test`: `vitest run`
  - `check`: runs all three in order.
- [x] **0.7 First test.** `engine/test/sanity.test.ts` with one test, `adds numbers`.
  - **Check:** `npm run check` passes. Change the test to fail and make sure `check` fails too.
- [x] **0.8 CI workflow.** `.github/workflows/ci.yml`:
  - Runs on push and pull request.
  - Matrix: `ubuntu-latest` and `windows-latest`, Node 20 and 22.
  - Steps: checkout, setup-node with npm cache, `npm ci`, `npm run check`.
  - **Check:** green tick on GitHub for all 4 combinations.

**Done when:** CI is green on Windows and Linux.
**Talking point:** "Every push is linted, type-checked and tested on two operating systems."

---

## Phase 1: Learn HTTP and files by hand (Weeks 1-2, about 10 hours)

**Goal:** learn the new low-level skills through small experiments, then build the fake server every later test depends on.

**Learn first:** everything in the table marked Phase 1. Read the MDN Range requests page fully. It's short and it's the core idea of the whole project.

Do exercises 1.1-1.6 in a `playground/` folder. They're throwaway. Commit them if you like, but they aren't part of the app.

- [ ] **1.1 See headers with curl.** Windows has `curl.exe` built in.
  - `curl -I -L <github release URL>`: find `Content-Length`, `Accept-Ranges`, `ETag`, `Content-Disposition`, and the redirect.
  - `curl -r 0-99 -L -o part.bin <url>`, then check that `part.bin` is exactly 100 bytes.
  - **Check:** you can say what each of those headers means.
- [ ] **1.2 Range request from Node.** A script that `fetch`es with header `Range: bytes=0-1023`, prints status, `Content-Range` and `res.url`, then reads the body in a `getReader()` loop and counts bytes.
  - **Check:** prints `206` and `1024`.
- [ ] **1.3 Writing at offsets.**
  1. Open a file with `fs/promises` `open(path, 'w+')`.
  2. `truncate` it to 10 bytes.
  3. Write `"abc"` at position 5, then `"xy"` at position 0.
  4. Close it, read it back, print it.
  - **Check:** you understand why the unwritten bytes are zeros. You must `close` before reading or renaming.
- [ ] **1.4 Parallel pieces.** Download a 20-50 MB file in 4 ranges at the same time with `Promise.all`, each writing at its own offset into one pre-sized file. Then download it again in one piece and compare SHA-256 hashes with `crypto.createHash('sha256')`.
  - **Check:** the hashes match. Compare with `probe.js` from the spike only afterwards.
- [ ] **1.5 Cancelling.** Start a download, call `controller.abort()` after 2 seconds, and catch the error.
  - **Check:** you can print `err.name === 'AbortError'`.
- [ ] **1.6 Events.** A small class `Ticker extends EventEmitter` that emits `'tick'` with a counter every second, with a `stop()` method.
  - **Check:** another file can listen to it and stop it.

**Now build the fake server**, the first real project code.

- [ ] **1.7 Fake server helper.**
  - **Files:** `engine/test/helpers/fakeServer.ts`, `engine/test/fakeServer.test.ts`.
  - **Signature:**
    ```ts
    type FakeServerOptions = {
      size?: number;                     // default 8 MiB; 0 => ranged requests get 416 with `Content-Range: bytes */0`
      ignoreRange?: boolean;             // always 200 with the full body
      etag?: string;
      contentDisposition?: string;
    };
    type FakeServer = {
      url: string;                       // e.g. http://127.0.0.1:PORT
      data: Buffer; sha256: string;
      requests: { path: string; range: string | null }[];
      close(): Promise<void>;
    };
    startFakeServer(options?: FakeServerOptions): Promise<FakeServer>;
    ```
  - Path `/file` serves the data. Listen on port `0` so the OS picks a free port, then read it back from `server.address()`.
  - **Tests:**
    - `ranged request returns 206 with exact Content-Range and bytes`
    - `no Range header returns 200 and full body`
    - `ignoreRange returns 200 even with a Range header`
    - `size 0 answers a range with 416 and bytes */0`
    - `records each request path and Range header`
  - **Hint:** don't build every mode now. Later steps tell you which mode to add, with a test for each. The spike's `server.js` shows the shape.
  - **Check:** `npx vitest run engine/test/fakeServer.test.ts` passes.

**Done when:** you can explain what 206 means, why a range's end is inclusive (`bytes=0-99` is 100 bytes), and the fake server's tests pass.
**Talking point:** "I tested against a fake server I can make misbehave, not against the live internet."

---

## Phase 2: Pure building blocks (Weeks 2-3, about 10 hours)

**Goal:** practise the test-first loop on code with no network: data types, saving records, splitting files, choosing filenames, and deciding how to retry.

**Learn first:** TS union types and type aliases. Re-read the test-first loop in section 4.

- [ ] **2.1 Shared types and errors.**
  - **Files:** `engine/src/types.ts`, `engine/src/errors.ts`.
  - These types are the contract between every part of the app, so copy them exactly:
    ```ts
    type SegmentState = { start: number; end: number; downloaded: number };   // end is inclusive
    type DownloadStatus = 'queued' | 'downloading' | 'waiting' | 'paused' | 'done' | 'error';
    type DownloadRecord = {
      id: string; url: string; finalUrl: string; filename: string; saveDir: string;
      size: number | null; etag: string | null; lastModified: string | null; rangeSupported: boolean;
      status: DownloadStatus; segments: SegmentState[]; error?: string; createdAt: string;
    };
    type ProbeResult = { finalUrl: string; size: number | null; rangeSupported: boolean;
                         filename: string; etag: string | null; lastModified: string | null };
    type EngineEvent =
      | { type: 'progress'; bytesDone: number; speed: number; etaSeconds: number | null }
      | { type: 'status'; status: DownloadStatus; error?: string };
    ```
  - Error classes, all extending `Error`:
    - `InvalidUrlError`
    - `HttpStatusError`, with fields `status: number` and `retryAfterMs: number | null`
    - `RangeIgnoredError`
    - `ShortSegmentError`
    - `CorruptRecordError`
  - **Check:** `npm run typecheck` passes.
- [ ] **2.2 Saving records safely.**
  - **File:** `engine/src/store.ts`.
  - `saveRecord(path, record)` writes JSON to `path + '.tmp'`, then renames it over `path`.
  - `loadRecord(path)` returns `null` if the file is missing, and throws `CorruptRecordError` if it can't be parsed.
  - **Why temp + rename:** a rename is all-or-nothing. If the app dies mid-write, the old file is still whole.
  - **Tests:**
    - `save then load returns an equal record`
    - `no .tmp file remains after save`
    - `load of a missing path returns null`
    - `invalid JSON throws CorruptRecordError`
  - **Hint:** use the OS temp folder (`os.tmpdir()` + `fs.mkdtemp`) in tests so they don't leave files around.
- [ ] **2.3 Splitting a file into segments.**
  - **File:** `engine/src/planner.ts`.
  - `planSegments(size, maxSegments = 8, minSegmentBytes = 1_048_576): SegmentState[]`
    - Number of segments = `floor(size / minSegmentBytes)`, kept between 1 and `maxSegments`.
    - The last segment absorbs the remainder.
    - Size 0 returns `[]`.
  - **Tests:**
    - `8 MiB gives 8 segments of 1 MiB`
    - `10 bytes with max 3 and min 1 gives [0-2],[3-5],[6-9]`
    - `100 bytes with defaults gives one segment 0-99`
    - `size 0 gives none`
    - `for 50 random sizes: segments start at 0, end at size-1, are contiguous, never overlap`
  - **Hint:** the last test is a loop. Write a small helper `assertCovers(segments, size)`, because you'll reuse it in 2.4 and Phase 4.
- [ ] **2.4 Work-stealing split (pure part).**
  - **File:** `engine/src/planner.ts`.
  - `stealWork(segments, minSplitBytes = 1_048_576): { segments: SegmentState[]; created: SegmentState } | null`
    1. Find the segment with the most bytes left: `end - (start + downloaded) + 1`.
    2. If that's under `minSplitBytes`, return `null`.
    3. Otherwise the original keeps the first `ceil(remaining / 2)` remaining bytes, and a new segment takes the rest.
    4. Insert the new segment right after the original.
    5. Return new arrays and objects. Don't change the input.
  - **Tests:**
    - `splits the segment with the largest remainder`
    - `original keeps the ceil half`
    - `returns null under 1 MiB remaining`
    - `combined segments still cover the same range with no gap or overlap` (use `assertCovers`)
    - `does not mutate its input`
- [ ] **2.5 Choosing a safe filename.**
  - **File:** `engine/src/filename.ts`.
  - **Signatures:**
    - `chooseFilename(contentDisposition: string | null, finalUrl: string, originalUrl: string): string`
    - `sanitizeFilename(name: string): string`
    - `uniqueName(dir: string, filename: string): Promise<string>`
  - **Order of preference:**
    1. `filename*` (percent-decoded UTF-8)
    2. `filename`
    3. Last path part of `finalUrl` (percent-decoded)
    4. Last path part of `originalUrl`
    5. `download`
  - **`sanitizeFilename` rules:**
    - Keep only what comes after the last `/` or `\`.
    - Replace `<>:"|?*` and control characters with `_`.
    - Prefix `_` to Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`), with or without an extension.
    - Remove trailing dots and spaces.
    - If nothing is left, move on to the next candidate.
  - **`uniqueName`:** a name is taken if the file *or* `<name>.part` exists. Try `name (1).ext`, `name (2).ext`, and so on.
  - **Tests:**
    - `filename="../../evil.exe" becomes evil.exe`
    - `C:\temp\a.zip becomes a.zip`
    - `a:b*c?.zip becomes a_b_c_.zip`
    - `CON.txt becomes _CON.txt`
    - `filename*=UTF-8''%E2%82%AC%20rates.txt becomes "€ rates.txt"`
    - `filename* wins over filename`
    - `no header uses the final URL's last path part`
    - `empty final path falls back to the original URL`
    - `nothing usable gives download`
    - `uniqueName gives a (1).zip then a (2).zip`
    - `a.zip.part counts as taken`
  - **Why this matters:** a server controls the filename. Without sanitizing, `../../` could write files outside the download folder. That's a real security bug, and catching it makes a good interview story.
- [ ] **2.6 Deciding how to retry.**
  - **File:** `engine/src/retry.ts`.
  - **Signatures:**
    ```ts
    type Failure =
      | { kind: 'network' } | { kind: 'server'; retryAfterMs: number | null }
      | { kind: 'linkExpired' } | { kind: 'permanent'; status: number }
      | { kind: 'rangeIgnored' } | { kind: 'diskFull' } | { kind: 'aborted' }
      | { kind: 'fatal'; message: string };
    classifyFailure(err: unknown): Failure
    backoffMs(attempt: number): number   // attempt 1 => 1000, then 2000, 4000, ... capped at 30000
    ```
  - **Mapping:**
    - `HttpStatusError` 5xx or 429 → `server`
    - 403, 410 → `linkExpired`
    - 400, 401, 404, 405, 451 → `permanent`
    - `RangeIgnoredError` → `rangeIgnored`
    - `ShortSegmentError`, `TypeError` "fetch failed", or codes `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`, `EPIPE`, `UND_ERR_SOCKET` → `network`
    - Codes `ENOSPC`, `EDQUOT`, `EROFS` → `diskFull`
    - Name `AbortError` → `aborted`
    - Anything else → `fatal`
  - **Tests:** one per mapping line, plus:
    - `backoffMs(1..6) is 1000,2000,4000,8000,16000,30000`
    - `backoffMs(10) is 30000`
  - **Hint:** Node's `fetch` hides the real network code inside `err.cause.code`. Check both `err.code` and `err.cause?.code`.

**Done when:** all Phase 2 tests pass and CI is green.
**Talking point:** "The tricky logic is in small, separately tested functions, so the network code stays simple."

---

## Phase 3: Talking to servers (Weeks 3-4, about 10 hours)

**Goal:** two functions that make real requests. `probe` asks the server about the file, and `runSegment` downloads one piece.

**Learn first:** re-read MDN on `ETag` and `If-Range`. Review your exercise 1.2 reader loop.

- [ ] **3.1 Add fake server modes.**
  - **New options:** `omitLength` (chunked response, no `Content-Length`), `extraBytes` (send N bytes past the range end), `dropEvery` (cut the connection halfway through every Nth response), `failNext(status, count?, retryAfterSeconds?)` (a method on the server).
  - **New paths:** `/redirect` answers 302 to `/file`.
  - **If-Range rule:** a range request whose `If-Range` value differs from the current `etag` gets `200` with the full body.
  - **Tests:** one each:
    - `omitLength sends no Content-Length`
    - `extraBytes sends N bytes past the range end`
    - `dropEvery cuts the Nth response short`
    - `failNext(503, 2) fails exactly two requests`
    - `/redirect answers 302 to /file`
    - `stale If-Range returns 200`
  - **Hint:** to drop a connection, write half the body, then call `req.socket.destroy()`.
- [ ] **3.2 Probe.**
  - **File:** `engine/src/probe.ts`.
  - `probe(url: string, signal?: AbortSignal): Promise<ProbeResult>`
  - **Before any request:** if the URL doesn't parse, or isn't `http:` or `https:`, throw `InvalidUrlError`. Use `new URL()` inside `try`.
  - **The request:** `GET` with `Range: bytes=0-0` and `Accept-Encoding: identity`. Redirects are followed automatically, and `res.url` is the final URL. Cancel the body after reading the headers.
  - **Reading the answer:**
    - `206` → `rangeSupported: true`, size = the number after `/` in `Content-Range`.
    - `200` → `rangeSupported: false`, size from `Content-Length`, or `null` if absent.
    - `416` with `bytes */0` → size `0`, `rangeSupported: false`.
    - Any other status ≥ 400 → throw `HttpStatusError`. Turn `Retry-After` seconds into `retryAfterMs`.
  - The filename comes from `chooseFilename`.
  - **Tests:**
    - `206 gives size, rangeSupported, etag, filename`
    - `ignoreRange gives rangeSupported false and size from Content-Length`
    - `omitLength gives size null`
    - `size 0 gives size 0`
    - `/redirect gives finalUrl ending in /file`
    - `404 throws HttpStatusError with status 404`
    - `503 with Retry-After 2 gives retryAfterMs 2000`
    - `ftp://x and "not a url" throw InvalidUrlError and the server saw no requests`
  - **Trap:** without `Accept-Encoding: identity`, a server may gzip the response, and Node's `fetch` unzips it silently. Your byte counts would then not match `Content-Length`.
  - **Trap:** if you don't cancel the body (`res.body?.cancel()`), the connection stays open and your tests may hang.
- [ ] **3.3 Download one segment.**
  - **File:** `engine/src/segment.ts`.
  - **Signature:**
    ```ts
    type SegmentOptions = {
      url: string; segment: SegmentState; etag: string | null; signal: AbortSignal;
      writeAt: (data: Uint8Array, position: number) => Promise<void>;
      onBytes: (count: number) => void;
    };
    runSegment(options: SegmentOptions): Promise<void>
    ```
  - **The request:** `Range: bytes=<start+downloaded>-<end>`, `Accept-Encoding: identity`, and `If-Range: <etag>` when `etag` is set.
  - **Status handling:** `200` → throw `RangeIgnoredError`. Any other non-206 → throw `HttpStatusError`.
  - **For each chunk:**
    1. Work out how many bytes are still wanted, re-reading `segment.end` every time, because Phase 4 will shorten it while this runs.
    2. Clip the chunk to that number.
    3. `await writeAt(chunk, position)`.
    4. Increase `segment.downloaded`.
    5. Call `onBytes`.
    - When you reach the end, cancel the response and return.
  - If the body ends before the segment is complete, throw `ShortSegmentError`. No retrying here, since that comes in Phase 4.
  - **Tests:**
    - `downloads a range into the right offsets; bytes equal server.data slice`
    - `resumes from segment.downloaded`
    - `extraBytes never reach writeAt`
    - `ignoreRange throws RangeIgnoredError`
    - `dropEvery throws ShortSegmentError and segment.downloaded equals bytes actually written`
    - `shortening segment.end mid-run stops at the new end`
    - `abort rejects with AbortError`
  - **Hint:** in tests, `writeAt` can copy into an in-memory `Buffer` of the file size. Compare it with `server.data` afterwards.
  - **Trap:** off-by-one. Bytes still wanted = `end - (start + downloaded) + 1`.

**Done when:** you can download one segment from the fake server, and every misbehaviour throws the right error.
**Talking point:** "I verify range support with a real request instead of trusting the `Accept-Ranges` header. Real servers lie."

---

## Phase 4: The Download class, the core (Weeks 4-7, about 35 hours)

**Goal:** one class that downloads a whole file in parallel, survives drops, pauses and resumes, falls back when it must, and keeps every connection busy.

**Learn first:**
- What `Promise.all` does when one promise rejects: it rejects at once, but the other tasks keep running. That's why one shared `AbortController` is needed to stop them all.
- `setInterval` and `clearInterval`.
- What `FileHandle.sync()` does and why (your OS notes on the page cache).

**The status flow** to keep in mind:
```
queued → downloading ⇄ waiting
             │   │
             │   └──→ paused ──→ downloading (on start)
             ├──→ done
             └──→ error
```

- [ ] **4.1 Speed meter.**
  - **File:** `engine/src/speed.ts`.
  - `class SpeedMeter { constructor(windowMs = 5000); add(bytes: number, nowMs: number): void; bytesPerSecond(nowMs: number): number }`
  - It keeps recent samples and averages over the last `windowMs`.
  - **Tests:**
    - `reports the average over the window`
    - `samples older than the window drop out`
  - **Hint:** pass the time in (`nowMs`) instead of calling `Date.now()` inside, so tests control time.
- [ ] **4.2 Download: the happy path.**
  - **File:** `engine/src/download.ts`. Export the public API from `engine/src/index.ts`.
  - **Signature:**
    ```ts
    createRecord(url: string, saveDir: string, id?: string): DownloadRecord   // status 'queued', no segments
    type DownloadOptions = {
      recordPath: string; maxSegments?: number; workStealing?: boolean;      // defaults 8, true
      saveProgressEveryMs?: number;                                          // default 1000
      sleep?: (ms: number, signal: AbortSignal) => Promise<void>;            // tests pass an instant one
      writeAt?: (handle: FileHandle, data: Uint8Array, position: number) => Promise<void>;
      syncFile?: (handle: FileHandle) => Promise<void>;
    };
    class Download extends EventEmitter {
      constructor(record: DownloadRecord, options: DownloadOptions);
      get record(): DownloadRecord;
      start(): Promise<void>;   // resolves when done, paused or error
      pause(): Promise<void>;
      // emits 'event' with an EngineEvent
    }
    ```
  - **Build `start()` in this order**, testing as you go:
    1. Emit status `downloading`.
    2. `probe` the URL and store the results in the record.
    3. `uniqueName` for the final filename.
    4. `planSegments`.
    5. Open `<saveDir>/<filename>.part` and `truncate` it to the full size (pre-sizing).
    6. Start one `runSegment` per segment, all at once, sharing one `AbortController`.
    7. Wait for all of them.
    8. **Close the file handle**, then `rename` `.part` to the final name.
    9. Set status `done`, save the record, emit status `done`.
  - **Progress:** a `setInterval` every 250 ms emits `progress` with:
    - `bytesDone`: the sum of `downloaded` across segments.
    - `speed` from `SpeedMeter`.
    - `etaSeconds`: remaining bytes divided by speed, or `null` if size or speed is unknown.
    - Clear the interval when finished.
  - **Tests:**
    - `8 MiB downloads in 8 segments; final file sha256 equals server.sha256`
    - `.part is gone and the final file exists`
    - `record is saved with status done`
    - `events: status downloading, then progress with non-decreasing bytesDone, then status done`
    - `existing a.zip gives a (1).zip`
    - `file handle is closed before rename` (spy on the order of calls)
  - **Hint:** many segments writing to one `FileHandle` at the same time is safe, because each write names its own position.
  - **Trap:** on Windows you can't rename a file that's still open. It works on Linux and fails on Windows, which is why CI runs both.
- [ ] **4.3 Pause, resume and saving progress.**
  - **`pause()`:** abort the shared controller, wait for the workers to stop, save the record, set `paused`.
  - **`start()` on a record that already has segments (resume):**
    1. Re-probe `record.url` (the *original* link) to get a fresh `finalUrl`.
    2. If `size` or `etag` changed, the file changed on the server, so reset to fresh segments and start from zero.
    3. Otherwise, continue each segment from its saved `downloaded`.
  - **While running:** every `saveProgressEveryMs`, first `syncFile(handle)`, then `saveRecord`, always in that order.
  - **Tests:**
    - `pause mid-download then start again finishes with matching sha256`
    - `after resume, no request starts below the saved offsets` (check `server.requests`)
    - `etag change before resume restarts from zero and still matches`
    - `size change restarts from zero`
    - `syncFile is called before each saveRecord`
    - `the record on disk shows progress within one save interval`
  - **Add fake server:** `setEtag(value)` and `bytesPerSecPerConnection` (throttling), so there's time to pause mid-download.
  - **Why the order matters:** if the record were saved first and the PC lost power, the record would claim bytes that never reached the disk. Resume would then skip them and the file would be corrupt.
- [ ] **4.4 Retries and the `waiting` status.** Wrap each `runSegment` in a retry loop driven by `classifyFailure`.
  - **Per failure kind:**
    - `network` → retry forever, waiting `backoffMs(attempt)` via `options.sleep`. Reset `attempt` after a success.
    - `server` → up to 5 attempts, waiting `retryAfterMs` if given, otherwise backoff. While any worker is retrying a server error, halve the allowed active workers (minimum 1). Restore the limit after a success.
    - `linkExpired` → re-probe `record.url` once, update `finalUrl`, retry. A second failure → status `error`.
    - `permanent` → status `error` at once, with a plain message such as "File not found (404)" or "Access denied (401)".
    - `diskFull` → status `paused` with `error: "Disk full"`.
    - `aborted` → stop quietly. That's a pause.
  - **When every active worker is waiting** on a network retry, emit status `waiting`, and go back to `downloading` after the next success.
  - **Add fake server:** `linkTtlMs` and a `/signed` path that redirects to a fresh `/blob?t=<n>` link, which returns 403 after `linkTtlMs`.
  - **Tests** (using an instant `sleep`):
    - `dropEvery 3 still finishes with matching sha256`
    - `failNext(503, 2) finishes`
    - `failNext(503, 6) ends in error after 5 attempts`
    - `404 ends in error with no retries`
    - `expired /signed link re-probes and finishes`
    - `403 twice ends in error`
    - `ENOSPC from writeAt gives paused with error "Disk full"`
    - `all workers backing off emits waiting, then downloading`
  - **Hint:** make `sleep` reject when the signal aborts, so a pause during a 30-second wait stops immediately.
  - **Hint for disk full:** you can't really fill a disk in a test. Pass a `writeAt` option that throws an error with `code: 'ENOSPC'`.
- [ ] **4.5 Single-stream fallback and odd sizes.**
  - **No range support** (`rangeSupported: false` from the probe, or any segment throws `RangeIgnoredError`):
    1. Abort all workers.
    2. Truncate `.part` to 0.
    3. Set `rangeSupported: false`.
    4. Download one plain stream with no `Range` header.
    - Pausing is allowed, but the next `start()` begins from zero.
  - **Unknown size (`null`):** progress has no ETA.
  - **Size 0:** create an empty file, rename it, `done`. No segment requests.
  - **Add fake server:** `ignoreRangeAfter: N` (the first N range requests get 206, the rest 200).
  - **Tests:**
    - `ignoreRange from the start finishes with matching sha256 and rangeSupported false`
    - `ignoreRangeAfter 1 falls back mid-download and still matches`
    - `omitLength finishes, size stays null, etaSeconds is null`
    - `size 0 gives an empty file, status done, no range requests`
    - `size 1 uses exactly one segment`
    - `pause then start on single-stream restarts from zero`
- [ ] **4.6 Work stealing.** When a worker finishes and others are still running:
  1. Call `stealWork` on the live segment list.
  2. Shorten the original segment's `end` in place (the running `runSegment` notices on its next chunk).
  3. Start a worker for the new segment.
  - Never run more than `maxSegments` at once. `record.segments` grows with each split, so resume needs no special handling.
  - **Add fake server:** `slowRangeStart`. Only a response for a range starting at that byte is throttled.
  - **Tests** (4 MiB file, the first segment throttled to 256 KB/s):
    - `with stealing, total time is under 60% of the workStealing:false time`
    - `sha256 still matches`
    - `record.segments grows beyond the first plan`
    - `segments still cover 0..size-1 with no gap or overlap`
    - `never more than maxSegments requests in flight` (count open requests in the fake server)
  - **Hint:** this is the trickiest part of the project. Do it last in this phase, because everything else must already be solid. Draw the segment list on paper before and after a split.

**Done when:** `npx vitest run engine` is green, including pause/resume, retries, fallback and stealing.
**Talking point:** "Work stealing keeps every connection busy until the end. I measured the speed-up against a deliberately slow segment."

---

## Phase 5: Command-line tool (Week 7, about 5 hours)

**Goal:** the first version you can actually use. `dl <url>` downloads a real file with a live progress line.

**Learn first:** `process.argv`, `process.stdout.write` with `\r` to update one line, exit codes, `child_process.spawn` (for the test).

- [ ] **5.1 The CLI.**
  - **File:** `engine/cli/dl.ts`. Run it with `npx tsx engine/cli/dl.ts <url> [--dir <folder>] [--segments <n>]`.
  - **Progress line:** percent, speed (`12.4 MB/s`), ETA, updated in place.
  - **Exit codes:** 0 when done. 1 on error, with a plain message on stderr. 1 for a bad URL.
  - The record goes in a temp state folder.
  - **Ctrl+C** pauses and exits. Running the same command again resumes, which is a nice bonus check.
  - **Tests** (spawn the CLI against the fake server):
    - `exits 0 and file sha256 matches`
    - `exits 1 for ftp://x with a plain message`
    - `exits 1 for a 404`
- [ ] **5.2 Try it for real.** Download a GitHub release, a nodejs.org installer, and a large file from a Linux mirror. Pull your Wi-Fi out mid-download and plug it back in.
  - **Check:** it waits, recovers, and the file opens or installs correctly. For anything that breaks, write a failing test first, then fix it.

**Done when:** you prefer `dl` over your browser for big files.
**Talking point:** "The engine has no UI dependency. The same library powers the CLI and the desktop app."

---

## Phase 6: Queue and crash recovery (Week 8, about 8 hours)

**Goal:** several downloads with a limit of 3 running, and nothing lost when the app is killed.

**Learn first:** `child_process.fork`, `process.send`, killing with `SIGKILL`. Review the OS concept that a killed process gets no chance to clean up.

- [ ] **6.1 Add the `queue` package.**
  - Add `"queue"` to root `workspaces`.
  - Create `queue/package.json` (name `@dl/queue`, depends on `@dl/engine`) and `queue/tsconfig.json`.
  - Add `-p queue` to the `typecheck` script.
  - Queue tests reuse the fake server with a relative import from `engine/test/helpers/fakeServer.ts`.
- [ ] **6.2 The queue.**
  - **File:** `queue/src/queue.ts`.
  - **Signature:**
    ```ts
    type QueueOptions = { stateDir: string; maxConcurrent?: number /* 3 */; maxSegments?: number;
                          downloadOptions?: Partial<DownloadOptions> };
    class DownloadQueue extends EventEmitter {
      constructor(options: QueueOptions);
      add(url: string, saveDir: string): Promise<string>;  // returns id; rejects InvalidUrlError
      pause(id: string): Promise<void>;
      resume(id: string): Promise<void>;                   // goes to the back of the line
      cancel(id: string): Promise<void>;                   // stops, deletes .part and the record
      remove(id: string): Promise<void>;                   // forgets a done/errored entry, keeps the file
      list(): DownloadRecord[];
      load(): Promise<void>;                               // see 6.3
      // emits 'changed' (record) on status changes, 'progress' (id, event), 'warning' (message)
    }
    ```
  - Each record is saved as `<stateDir>/<id>.json`. First added starts first. When one finishes, fails or pauses, the next waiting one starts.
  - **Tests:**
    - `5 downloads never run more than 3 at once`
    - `start order is add order`
    - `pausing a running one starts the next`
    - `resume puts it at the back`
    - `cancel removes the .part and the record file`
    - `remove keeps the finished file`
    - `add("ftp://x") rejects with InvalidUrlError and saves nothing`
    - `each status change is saved to <stateDir>/<id>.json`
  - **Hint:** check the URL with the same rule as `probe` *before* creating a record, so a bad link never appears in the list.
- [ ] **6.3 Crash recovery.**
  - **`load()`:**
    1. Read every `<stateDir>/*.json`.
    2. Records in `downloading`, `waiting` or `queued` become `paused`. Nothing starts by itself.
    3. If the `.part` file is missing, or its size doesn't match `record.size`, reset that download to start from zero.
    4. A corrupt file is skipped and reported with a `'warning'` event.
  - **Tests:**
    - `downloading records load as paused`
    - `missing .part restarts from zero`
    - `wrong-size .part restarts from zero`
    - `a corrupt json is skipped with a warning; others still load`
- [ ] **6.4 The crash test, the most important test in the project.**
  - **Child script** `queue/test/helpers/crashChild.ts`: adds one throttled download to a queue in a given `stateDir`, and calls `process.send('ready')` once at least 2 MiB are on disk.
  - **The test:**
    1. Fork the child.
    2. Wait for `ready`.
    3. Kill it with `SIGKILL`.
    4. Make a new queue on the same `stateDir`.
    5. `load`, `resume`, and wait for `done`.
    6. Check the SHA-256 equals `server.sha256`.
  - **Check:** run it 10 times in a row (`for` loop in the terminal). It must pass every time. A test that fails 1 in 10 runs is hiding a real bug.

**Done when:** you can kill the process at any moment and get a perfect file after resuming.
**Talking point:** "My crash test kills the process with `SIGKILL` mid-download and proves the resumed file is byte-identical."

---

## Phase 7: Desktop app (Weeks 9-10, about 15 hours)

**Goal:** an Electron window with a React download list. Add a URL, see progress, pause, resume, retry.

**Learn first** (this is the second big learning bump):
- Read Electron's **Process model**, **IPC** and **Security** pages fully.
- Understand **main** (Node, full power) vs **renderer** (a web page, no Node access).
- Understand **preload**, the small bridge that exposes chosen functions to the page.
- Know why `contextIsolation: true` and `nodeIntegration: false` matter: a web page with Node access can delete your files.

- [ ] **7.1 Hello window.**
  - Add `"app"` to `workspaces`.
  - Scaffold `app/` using electron-vite's React + TypeScript template (follow its Getting Started page). Delete the demo content.
  - **Check:** `npm run dev -w app` opens a window with "Hello".
  - **Trap:** `@dl/engine` and `@dl/queue` are TypeScript source, not built packages. Make sure electron-vite *bundles* them into the main process instead of treating them as external packages (see its dependency-handling docs). Otherwise Electron tries to load `.ts` files at runtime and crashes.
- [ ] **7.2 One command over IPC.** Expose `window.downloads.ping()` through `contextBridge.exposeInMainWorld` in the preload. The main process answers with `ipcMain.handle`, and the page shows the reply.
  - **Check:** the button shows "pong". You now understand the whole renderer → preload → main path.
- [ ] **7.3 Shared API types.**
  - **File:** `app/shared/api.ts`.
    ```ts
    type DownloadView = DownloadRecord & { bytesDone: number; speed: number; etaSeconds: number | null };
    interface DownloadsApi {
      add(url: string): Promise<void>; pause(id: string): Promise<void>; resume(id: string): Promise<void>;
      cancel(id: string): Promise<void>; remove(id: string): Promise<void>; list(): Promise<DownloadView[]>;
      onUpdate(callback: (changed: DownloadView[]) => void): () => void;   // returns unsubscribe
    }
    ```
  - Declare `window.downloads: DownloadsApi` for TypeScript.
- [ ] **7.4 Update batcher.**
  - **File:** `app/main/updateBatcher.ts`.
  - `createUpdateBatcher(send, intervalMs = 250): { progress(view), status(view), stop() }`
    - `status` sends immediately, including any pending progress for that id.
    - `progress` collects updates and sends at most once per interval.
  - **Tests:**
    - `many progress calls within 250 ms give one send`
    - `status sends immediately with pending progress merged`
  - **Hint:** use Vitest fake timers (`vi.useFakeTimers()`).
  - **Why:** 3 downloads with 8 segments each would otherwise flood the page with thousands of messages a second and freeze it.
- [ ] **7.5 Wire the queue into main.**
  - **File:** `app/main/ipc.ts`. `registerIpc(queue, send)` maps each `DownloadsApi` command to the queue. It builds each `DownloadView` from the record plus the last progress event for that id, and feeds queue events into the batcher.
  - **On startup**, `main.ts`:
    1. Creates the queue with `stateDir` under `app.getPath('userData')`.
    2. Uses `app.getPath('downloads')` as the save folder.
    3. Calls `queue.load()`.
    4. Registers IPC.
    5. Opens the window.
  - **Window security** (keep these settings in `app/main/windowOptions.ts`): `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and the preload path.
  - **Tests:**
    - `registerIpc routes each command to the queue` (pass a fake queue object)
    - `windowOptions has contextIsolation true and nodeIntegration false`
- [ ] **7.6 React UI.**
  - **Files:** `app/renderer/` with `App.tsx`, `useDownloads.ts`, `format.ts`, and `components/DownloadList.tsx`, `DownloadRow.tsx`, `AddUrlDialog.tsx`.
  - **Functions:**
    - `formatBytes(1536)` → `"1.5 KB"`.
    - `formatEta(null)` → `"--"`.
    - `useDownloads()` loads `list()` once, then merges each `onUpdate` batch by id, and unsubscribes on unmount.
  - **Row rules:**
    - Pause while `downloading` or `waiting`; Resume while `paused`.
    - When `error`: the plain error text, plus a Retry button that calls `resume`.
    - When `rangeSupported` is false: the note "Can't resume: the server doesn't support it".
    - Show a progress bar, speed, ETA and size.
  - **Tests** (add `// @vitest-environment jsdom` at the top; install `jsdom` and `@testing-library/react`):
    - `formatBytes and formatEta cases`
    - `row shows Pause when downloading, Resume when paused`
    - `row shows error text and Retry; Retry calls resume`
    - `row shows the non-resumable note`
    - `dialog rejects empty input and calls onAdd with a trimmed URL`
  - You know React well. Spend your effort on making it look clean, using your design skills.
- [ ] **7.7 Manual test pass.** In the running app:
  1. Add 5 URLs and see only 3 run.
  2. Pause and resume one.
  3. Add `ftp://x` and see a clear message.
  4. Turn Wi-Fi off and see `waiting`, then recovery.
  5. Close the app mid-download, reopen it, and Resume.
  - **Check:** every case behaves as the spec says.

**Done when:** your friends could use it without you explaining anything.
**Talking point:** "The renderer has no Node access. It talks through a narrow preload bridge, which is Electron's recommended secure setup."

---

## Phase 8: Ship it (Weeks 11-12, about 12 hours)

**Goal:** installers on a GitHub Release, proof that it's fast, and a README that sells it.

**Learn first:** electron-builder basics, semantic versioning (`0.1.0`), Git tags.

- [ ] **8.1 Installers.** Configure electron-builder (`app/electron-builder.yml`) for a Windows NSIS installer, a Linux AppImage and a `.deb`. Add a `dist` script.
  - **Check:** `npm run dist -w app` produces an installer. Install it on your laptop and download a file with the installed app.
- [ ] **8.2 Release workflow.** `.github/workflows/release.yml` runs when you push a tag starting with `v`. It builds on Windows and Linux, and attaches the installers to a GitHub Release. Start a `CHANGELOG.md`.
  - **Check:** push tag `v0.1.0` and see the Release page with both installers.
- [ ] **8.3 Use it for a week.** Make it your only download tool. Every bug gets a failing test first, then the fix.
- [ ] **8.4 Benchmark.** `engine/bench/bench.ts` starts a fake server (32 MiB, each connection capped at 1 MiB/s) and times three runs: 1 segment, 8 segments without stealing, and 8 segments with stealing. It prints a table of seconds and MB/s.
  - **Check:** 8 segments is clearly faster than 1.
- [ ] **8.5 README.** Include:
  - What it is.
  - A screenshot and a demo GIF.
  - An architecture diagram (a Mermaid diagram of engine → queue → main → renderer).
  - The benchmark table.
  - Design decisions from `DECISIONS.md` (offset writes, work stealing, ETag check on resume, saving data before progress).
  - Known limits.
  - How to run the tests.
- [ ] **8.6 Final check.** `npm run check` is green, CI is green, and the Release is public.

**Done when:** a stranger can download your installer from GitHub and use it.

---

## Common traps (keep this open while coding)

| Trap | What happens | Fix |
|---|---|---|
| Range end is inclusive | Off-by-one, the file is 1 byte short or long | `bytes=0-99` is 100 bytes; remaining = `end - pos + 1` |
| Missing `Accept-Encoding: identity` | Byte counts don't match the size | Always send it on download requests |
| Body not cancelled | Connections pile up, tests hang | `res.body?.cancel()` / `reader.cancel()` when done early |
| Rename while the file is open | Works on Linux, fails on Windows | `await handle.close()` before `rename` |
| `Promise.all` and failure | One segment fails, the others keep downloading | One shared `AbortController`; abort on fatal errors |
| Saving progress on every chunk | Slow, disk thrashing | Save on a 1-second timer |
| Saving the record before data | A power cut leaves the record ahead of the file, which ends up corrupt | `sync()` the file first, then save the record |
| Trusting `Accept-Ranges` | Some servers say yes and send 200 | Check for a real 206; fall back on 200 mid-download |
| Trusting the server's filename | `../../` writes outside the folder | Always `sanitizeFilename` |
| Network code hidden in `err.cause` | Retry logic misclassifies errors | Check `err.code` and `err.cause?.code` |
| Real `sleep` in tests | Tests take minutes | Inject `sleep`; pass an instant one in tests |
| Flaky crash test | Random failures | Run it 10 times; a flaky test means a real bug |
| Electron treats workspace packages as external | App crashes loading `.ts` at runtime | Have electron-vite bundle `@dl/engine` and `@dl/queue` |

## V1 done checklist

- [ ] Pasting a URL downloads it in up to 8 parallel segments
- [ ] Pause and resume work, including after a link expires
- [ ] A file changed on the server restarts cleanly instead of corrupting
- [ ] Servers without range support still download (single stream)
- [ ] Up to 3 downloads at once; the rest wait in line
- [ ] Killing the app mid-download loses nothing after Resume
- [ ] Clear error messages with Retry
- [ ] Tests and CI green on Windows and Linux
- [ ] Installers on a GitHub Release
- [ ] README with architecture diagram, benchmark and demo

## After V1

The browser extension comes next. It catches downloads in the browser and sends them to the app. It will get its own short design and plan, building on the same engine without changing it.

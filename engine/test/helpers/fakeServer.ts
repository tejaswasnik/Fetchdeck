import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

export type FakeServerOptions = {
  size?: number; // default 8 MiB; 0 => ranged requests get 416 with `Content-Range: bytes */0`
  ignoreRange?: boolean; // always 200 with the full body
  etag?: string;
  contentDisposition?: string;
  omitLength?: boolean; // chunked responses, no Content-Length; 206 says `bytes a-b/*`
  extraBytes?: number; // send N bytes past the range end
  dropEvery?: number; // cut every Nth data response halfway through
  bytesPerSecPerConnection?: number; // throttle every data response
  linkTtlMs?: number; // /signed links expire (403 on /blob) after this long
  ignoreRangeAfter?: number; // first N range requests get 206, the rest 200
  slowRangeStart?: number; // only a range starting at this byte is throttled...
  slowBytesPerSec?: number; // ...to this speed (default 256 KiB/s)
};

export type FakeServer = {
  url: string;
  data: Buffer;
  sha256: string;
  requests: { path: string; range: string | null; headers: IncomingHttpHeaders }[];
  failNext(status: number, count?: number, retryAfterSeconds?: number): void;
  setEtag(value: string | undefined): void;
  setThrottle(bytesPerSecPerConnection: number | undefined): void;
  maxInFlight(): number;
  close(): Promise<void>;
};

const DEFAULT_SIZE = 8 * 1024 * 1024;
const TICK_MS = 25;

type ByteRange = { start: number; end: number };

// Supports "bytes=a-b" and "bytes=a-"; returns null when unsatisfiable or malformed.
const parseRange = (header: string, size: number): ByteRange | null => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) return null;
  return { start, end };
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const writeBody = async (res: ServerResponse, body: Buffer, bytesPerSec: number | null, dropAfter: number | null) => {
  const limit = dropAfter ?? body.length;
  const step = bytesPerSec ? Math.max(1, Math.floor((bytesPerSec * TICK_MS) / 1000)) : 64 * 1024;
  for (let pos = 0; pos < limit; pos += step) {
    if (res.destroyed) return;
    const ok = res.write(body.subarray(pos, Math.min(pos + step, limit)));
    if (bytesPerSec) await sleep(TICK_MS);
    else if (!ok) await new Promise((r) => res.once('drain', r));
  }
  if (dropAfter === null) {
    res.end();
    return;
  }
  // let the partial body reach the client before cutting the connection
  await new Promise<void>((r) => res.write('', () => r()));
  await sleep(10);
  res.socket?.destroy();
};

export const startFakeServer = async (options: FakeServerOptions = {}): Promise<FakeServer> => {
  const size = options.size ?? DEFAULT_SIZE;
  const data = randomBytes(size);
  const sha256 = createHash('sha256').update(data).digest('hex');
  const requests: FakeServer['requests'] = [];
  const failures: { status: number; retryAfterSeconds?: number }[] = [];
  const tokens = new Map<string, number>();
  let etag = options.etag;
  let throttle = options.bytesPerSecPerConnection;
  let dataResponses = 0;
  let rangeRequests = 0;
  let nextToken = 1;
  let inFlight = 0;
  let peakInFlight = 0;

  const baseHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { 'Accept-Ranges': 'bytes' };
    if (etag) headers.ETag = etag;
    if (options.contentDisposition) headers['Content-Disposition'] = options.contentDisposition;
    return headers;
  };

  const serveData = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    let counted = true;
    const release = (): void => {
      if (counted) inFlight--;
      counted = false;
    };
    res.on('finish', release);
    res.on('close', release);

    const failure = failures.shift();
    if (failure) {
      const headers: Record<string, string> = {};
      if (failure.retryAfterSeconds !== undefined) headers['Retry-After'] = String(failure.retryAfterSeconds);
      res.writeHead(failure.status, { ...headers, 'Content-Length': 0 }).end();
      return;
    }

    const range = req.headers.range ?? null;
    let wantRange = range !== null && !options.ignoreRange;
    if (range !== null) {
      rangeRequests++;
      if (options.ignoreRangeAfter !== undefined && rangeRequests > options.ignoreRangeAfter) wantRange = false;
    }
    const ifRange = req.headers['if-range'];
    if (wantRange && ifRange !== undefined && ifRange !== etag) wantRange = false;

    const dropping = options.dropEvery !== undefined && ++dataResponses % options.dropEvery === 0;
    const parsed = wantRange && range !== null ? parseRange(range, size) : null;

    if (wantRange && !parsed) {
      res.writeHead(416, { ...baseHeaders(), 'Content-Range': `bytes */${size}`, 'Content-Length': 0 }).end();
      return;
    }

    const throttled =
      options.slowRangeStart !== undefined && parsed?.start === options.slowRangeStart
        ? (options.slowBytesPerSec ?? 256 * 1024)
        : (throttle ?? null);

    let body: Buffer;
    const headers = baseHeaders();
    let status = 200;
    if (parsed) {
      status = 206;
      body = data.subarray(parsed.start, parsed.end + 1);
      headers['Content-Range'] = `bytes ${parsed.start}-${parsed.end}/${options.omitLength ? '*' : size}`;
    } else {
      body = data;
    }
    const declaredLength = body.length;
    if (options.extraBytes) body = Buffer.concat([body, Buffer.alloc(options.extraBytes, 0xff)]);
    if (!options.omitLength && !options.extraBytes) headers['Content-Length'] = String(declaredLength);
    if (!options.omitLength && options.extraBytes) headers['Content-Length'] = String(body.length);

    res.writeHead(status, headers);
    await writeBody(res, body, throttled, dropping ? Math.floor(body.length / 2) : null);
  };

  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    requests.push({ path: url.pathname, range: req.headers.range ?? null, headers: req.headers });

    if (url.pathname === '/file') {
      void serveData(req, res);
    } else if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/file', 'Content-Length': 0 }).end();
    } else if (url.pathname === '/cross') {
      // Redirects to another server (another origin), e.g. a CDN.
      res.writeHead(302, { Location: url.searchParams.get('to') ?? '/file', 'Content-Length': 0 }).end();
    } else if (url.pathname === '/signed') {
      const token = String(nextToken++);
      tokens.set(token, Date.now());
      res.writeHead(302, { Location: `/blob?t=${token}`, 'Content-Length': 0 }).end();
    } else if (url.pathname === '/blob') {
      const issued = tokens.get(url.searchParams.get('t') ?? '');
      const expired = issued === undefined || (options.linkTtlMs !== undefined && Date.now() - issued > options.linkTtlMs);
      if (expired) res.writeHead(403, { 'Content-Length': 0 }).end();
      else void serveData(req, res);
    } else {
      res.writeHead(404, { 'Content-Length': 0 }).end();
    }
  };

  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    data,
    sha256,
    requests,
    failNext: (status, count = 1, retryAfterSeconds) => {
      for (let i = 0; i < count; i++) failures.push({ status, retryAfterSeconds });
    },
    setEtag: (value) => {
      etag = value;
    },
    setThrottle: (value) => {
      throttle = value;
    },
    maxInFlight: () => peakInFlight,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
};

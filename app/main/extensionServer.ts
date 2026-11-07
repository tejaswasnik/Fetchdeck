import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CaptureLine } from './captureLine';
import { asCaptureBody } from './validate';

// No Electron imports here: the extension's end-to-end test runs this file in plain Node.

export type ExtensionServerStatus = 'off' | 'running' | 'port-in-use';

export type ExtensionServer = {
  /** Never rejects: a port that cannot be used leaves the server off and the status at 'port-in-use'. */
  start(): Promise<'running' | 'port-in-use'>;
  /** Dismisses every pending capture (so each browser download resumes), then closes the port. */
  stop(): Promise<void>;
  status(): ExtensionServerStatus;
  /** The port actually bound; useful when the server was started on port 0. */
  port(): number;
};

type Options = {
  port?: number;
  version: string;
  getToken: () => Promise<string>;
  line: CaptureLine;
  now?: () => number;
};

export const DEFAULT_PORT = 47600;
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const DISCARD_LIMIT_BYTES = 1024 * 1024; // beyond this, stop reading and hang up
const MAX_WAIT_SECONDS = 20;
const LOCKOUT = { failures: 10, windowMs: 60_000 } as const;
const CAPTURE_PATH = /^\/v1\/captures\/([A-Za-z0-9-]{1,64})$/;

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const sameSecret = (given: string, expected: string): boolean => {
  // Hashing first gives equal-length buffers, so neither the length nor the content leaks through timing.
  const digest = (text: string): Buffer => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(given), digest(expected));
};

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const kept: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > DISCARD_LIMIT_BYTES) {
        reject(new Refusal(413, 'That capture is too large.', { Connection: 'close' }));
        req.destroy();
      } else if (total <= MAX_BODY_BYTES) {
        kept.push(chunk);
      }
    });
    req.on('end', () => (total > MAX_BODY_BYTES ? reject(new Refusal(413, 'That capture is too large.')) : resolve(Buffer.concat(kept))));
    req.on('error', reject);
  });

const parseJson = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new Refusal(400, 'The capture is not valid JSON.');
  }
};

const waitMilliseconds = (value: string | null): number => {
  const seconds = Number(value ?? 0);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), MAX_WAIT_SECONDS) * 1000 : 0;
};

export const createExtensionServer = (options: Options): ExtensionServer => {
  const { version, getToken, line } = options;
  const now = options.now ?? Date.now;
  const requestedPort = options.port ?? DEFAULT_PORT;
  let http: Server | null = null;
  let status: ExtensionServerStatus = 'off';
  let boundPort = requestedPort;
  const failures: number[] = [];

  const recentFailures = (): number => {
    const cutoff = now() - LOCKOUT.windowMs;
    while (failures.length > 0 && failures[0]! <= cutoff) failures.shift();
    return failures.length;
  };

  // Order matters. Host first (DNS rebinding), then Origin, so a web page cannot burn the extension's
  // failure allowance, then the lockout, and only then the token itself.
  const authenticate = async (req: IncomingMessage): Promise<void> => {
    const host = req.headers.host;
    if (host !== `${HOST}:${boundPort}` && host !== `localhost:${boundPort}`) throw new Refusal(403, 'Unexpected Host.');
    const origin = req.headers.origin;
    if (origin !== undefined && !origin.startsWith('chrome-extension://')) throw new Refusal(403, 'Unexpected Origin.');
    if (recentFailures() >= LOCKOUT.failures) throw new Refusal(429, 'Too many wrong tokens. Try again in a minute.', { 'Retry-After': '60' });
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!sameSecret(given, await getToken())) {
      failures.push(now());
      throw new Refusal(401, 'Wrong token.');
    }
  };

  const route = async (req: IncomingMessage): Promise<{ status: number; body: unknown }> => {
    await authenticate(req);
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    const method = req.method ?? 'GET';

    if (url.pathname === '/v1/ping') {
      if (method !== 'GET') throw new Refusal(405, 'Use GET.', { Allow: 'GET' });
      return { status: 200, body: { app: 'fetchdeck', version } };
    }

    if (url.pathname === '/v1/captures') {
      if (method !== 'POST') throw new Refusal(405, 'Use POST.', { Allow: 'POST' });
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new Refusal(415, 'Send JSON.');
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > DISCARD_LIMIT_BYTES) throw new Refusal(413, 'That capture is too large.', { Connection: 'close' });
      let input;
      try {
        input = asCaptureBody(parseJson(await readBody(req)));
      } catch (error) {
        throw error instanceof Refusal ? error : new Refusal(400, error instanceof Error ? error.message : 'Bad capture.');
      }
      const result = line.submit(input);
      if (!result.ok) throw new Refusal(429, 'Fetchdeck has too many captures waiting.');
      return { status: 202, body: { captureId: result.id } };
    }

    const capture = CAPTURE_PATH.exec(url.pathname);
    if (capture) {
      if (method !== 'GET') throw new Refusal(405, 'Use GET.', { Allow: 'GET' });
      const outcome = await line.poll(capture[1]!, waitMilliseconds(url.searchParams.get('wait')));
      if (outcome === 'unknown') throw new Refusal(404, 'That capture is gone.');
      return { status: 200, body: { state: outcome } };
    }

    throw new Refusal(404, 'Not found.');
  };

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
    if (res.headersSent || res.writableEnded) return;
    // No CORS headers, ever: only the extension (which has host permission) may read these answers.
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(http === null ? { Connection: 'close' } : {}), ...headers });
    res.end(JSON.stringify(body));
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const { status, body } = await route(req);
      send(res, status, body);
    } catch (error) {
      if (error instanceof Refusal) send(res, error.status, { error: error.message }, error.headers);
      else send(res, 500, { error: 'Something went wrong in Fetchdeck.' });
    }
  };

  return {
    start() {
      if (http) return Promise.resolve('running');
      return new Promise((resolve) => {
        // Whatever stops the port from being used (taken by another program, reserved by Windows, out of range)
        // leaves the server off with a status Settings can show. Starting the app must never fail because of it.
        const unusable = (): void => {
          status = 'port-in-use';
          resolve('port-in-use');
        };
        const server = createServer((req, res) => void handle(req, res));
        server.once('error', unusable);
        try {
          server.listen(requestedPort, HOST, () => {
            http = server;
            boundPort = (server.address() as AddressInfo).port;
            status = 'running';
            resolve('running');
          });
        } catch {
          unusable();
        }
      });
    },

    async stop() {
      const server = http;
      http = null;
      status = 'off';
      line.closeAll();
      if (!server) return;
      await new Promise<void>((resolve) => {
        // Let the dismissed long-polls write their answer first, then hang up whatever is left.
        const hangUp = setTimeout(() => server.closeAllConnections(), 500);
        server.close(() => {
          clearTimeout(hangUp);
          resolve();
        });
        server.closeIdleConnections();
      });
    },

    status: () => status,
    port: () => boundPort,
  };
};

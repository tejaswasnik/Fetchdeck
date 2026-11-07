import type { CapturePayload } from './buildCapture';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:47600';
/** Each long-poll waits this long; a spike showed the service worker stays alive through repeated 20 s waits. */
export const POLL_WAIT_SECONDS = 20;

const REQUEST_TIMEOUT_MS = 10_000;
const POLL_TIMEOUT_MS = (POLL_WAIT_SECONDS + 10) * 1000;
const MAX_FAILED_POLLS = 3;

export type ClientErrorKind = 'not-running' | 'wrong-token' | 'rejected';

export class ClientError extends Error {
  constructor(
    readonly kind: ClientErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

export type FetchdeckClient = {
  ping(): Promise<{ version: string }>;
  postCapture(payload: CapturePayload): Promise<{ captureId: string }>;
  waitForOutcome(id: string): Promise<'accepted' | 'dismissed'>;
};

type Options = {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetch?: typeof fetch;
  /** Pause between failed polls. */
  retryDelayMs?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const body: unknown = await response.json();
    return isRecord(body) ? body : {};
  } catch {
    return {};
  }
};

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export const createFetchdeckClient = (options: Options): FetchdeckClient => {
  const { baseUrl, getToken } = options;
  const send = options.fetch ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 500;

  // One request; every failure becomes a ClientError so the caller can always resume the browser download.
  const request = async (path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await send(`${baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${await getToken()}`,
          ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ClientError('not-running', 'Fetchdeck is not running, or the browser extension is switched off in its settings.');
    }
    const body = await readJson(response);
    if (response.status === 401) throw new ClientError('wrong-token', 'Fetchdeck did not accept the pairing token.');
    if (!response.ok) {
      const reason = typeof body.error === 'string' ? body.error : `Fetchdeck answered ${response.status}.`;
      throw new ClientError('rejected', reason);
    }
    return body;
  };

  return {
    async ping() {
      const body = await request('/v1/ping');
      // Something else may be listening on the port; it is not Fetchdeck, so it is as good as not running.
      if (body.app !== 'fetchdeck' || typeof body.version !== 'string') {
        throw new ClientError('not-running', 'Something other than Fetchdeck answered on that port.');
      }
      return { version: body.version };
    },

    async postCapture(payload) {
      const body = await request('/v1/captures', { method: 'POST', body: payload });
      if (typeof body.captureId !== 'string') throw new ClientError('rejected', 'Fetchdeck gave an answer this extension does not understand.');
      return { captureId: body.captureId };
    },

    async waitForOutcome(id) {
      let failed = 0;
      for (;;) {
        try {
          const body = await request(`/v1/captures/${encodeURIComponent(id)}?wait=${POLL_WAIT_SECONDS}`, { timeoutMs: POLL_TIMEOUT_MS });
          failed = 0;
          if (body.state === 'accepted' || body.state === 'dismissed') return body.state;
          if (body.state !== 'pending') throw new ClientError('rejected', 'Fetchdeck gave an answer this extension does not understand.');
        } catch (error) {
          if (!(error instanceof ClientError) || ++failed >= MAX_FAILED_POLLS) throw error;
          await sleep(retryDelayMs);
        }
      }
    },
  };
};

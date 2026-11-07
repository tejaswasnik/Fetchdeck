import type { RequestHeaders } from '@fetchdeck/engine';

/** Where a download's credentials (Cookie, Referer, User-Agent) live. They are never part of the download record. */
export type AuthStore = {
  save(id: string, headers: RequestHeaders): Promise<void>;
  /** `null` when this download never had credentials. */
  load(id: string): Promise<RequestHeaders | null>;
  delete(id: string): Promise<void>;
  /** Every id that has credentials, so leftovers can be cleaned up when the queue loads. */
  ids(): Promise<string[]>;
};

/** Thrown by a store that knows credentials existed but cannot produce them (for example after a restart without encryption). */
export class CredentialsUnavailableError extends Error {
  constructor(message = 'Needs the link from your browser again') {
    super(message);
    this.name = 'CredentialsUnavailableError';
  }
}

export const createMemoryAuthStore = (): AuthStore => {
  const saved = new Map<string, RequestHeaders>();
  return {
    save: async (id, headers) => void saved.set(id, { ...headers }),
    load: async (id) => saved.get(id) ?? null,
    delete: async (id) => void saved.delete(id),
    ids: async () => [...saved.keys()],
  };
};

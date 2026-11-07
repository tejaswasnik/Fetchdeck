// Credentials the browser extension can hand to a download. Nothing else is ever forwarded.
export type RequestHeaders = { Cookie?: string; Referer?: string; 'User-Agent'?: string };
export type HeadersProvider = (url: string) => Promise<RequestHeaders>;

const ALLOWED = ['Cookie', 'Referer', 'User-Agent'] as const;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

// Anything outside the allow-list, any non-string, and any value that could split a header is dropped.
export const pickAllowedHeaders = (input: unknown): RequestHeaders => {
  if (typeof input !== 'object' || input === null) return {};
  const source: Record<string, unknown> = { ...input };
  const picked: RequestHeaders = {};
  for (const name of ALLOWED) {
    const value = source[name];
    if (typeof value === 'string' && value !== '' && !CONTROL_CHARACTERS.test(value)) picked[name] = value;
  }
  return picked;
};

// fetch wants plain string values, so the optional fields are flattened.
export const headerRecord = (headers: RequestHeaders = {}): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const name of ALLOWED) {
    const value = headers[name];
    if (value !== undefined) record[name] = value;
  }
  return record;
};

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

// The Cookie belongs to the site the user was logged in to. A redirect to a CDN, or a segment request that
// goes straight to the redirected address, must not carry it.
export const headersForUrl = (provided: RequestHeaders, targetUrl: string, originalUrl: string): RequestHeaders => {
  const target = originOf(targetUrl);
  const original = originOf(originalUrl);
  if (target !== null && target === original) return { ...provided };
  const withoutCookie = { ...provided };
  delete withoutCookie.Cookie;
  return withoutCookie;
};

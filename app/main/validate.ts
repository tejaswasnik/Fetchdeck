import { assertHttpUrl } from '@fetchdeck/engine';
import { SETTINGS_LIMITS, type SettingsPatch } from '../shared/api';
import type { CaptureInput } from './captureLine';

const MAX_URL_LENGTH = 2048;

// The page is untrusted: anything it sends over IPC is checked here before it reaches the queue or the disk.
export const asUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter a link to download.');
  if (value.length > MAX_URL_LENGTH) throw new Error(`That link is too long (the limit is ${MAX_URL_LENGTH} characters).`);
  assertHttpUrl(value);
  return value;
};

export const asId = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') throw new Error('Unknown download.');
  return value;
};

const isWholeNumberIn = (value: unknown, limits: { min: number; max: number }): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= limits.min && value <= limits.max;

// The save folder is deliberately not accepted here: it changes only through the folder picker in the main process.
export const asSettingsPatch = (value: unknown): SettingsPatch => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Settings must be an object.');
  const input: Record<string, unknown> = { ...value };
  const patch: SettingsPatch = {};
  for (const key of Object.keys(input)) {
    const item = input[key];
    if (key === 'maxConcurrent') {
      if (!isWholeNumberIn(item, SETTINGS_LIMITS.maxConcurrent)) {
        throw new Error(`Simultaneous downloads must be a whole number from ${SETTINGS_LIMITS.maxConcurrent.min} to ${SETTINGS_LIMITS.maxConcurrent.max}.`);
      }
      patch.maxConcurrent = item;
    } else if (key === 'maxSegments') {
      if (!isWholeNumberIn(item, SETTINGS_LIMITS.maxSegments)) {
        throw new Error(`Connections per download must be a whole number from ${SETTINGS_LIMITS.maxSegments.min} to ${SETTINGS_LIMITS.maxSegments.max}.`);
      }
      patch.maxSegments = item;
    } else if (key === 'notifications') {
      if (typeof item !== 'boolean') throw new Error('Notifications must be on or off.');
      patch.notifications = item;
    } else {
      throw new Error(`Unknown setting: ${key}.`);
    }
  }
  return patch;
};

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const CAPTURE_TEXT_LIMITS = { cookie: 8192, referer: 2048, userAgent: 2048, filename: 255 } as const;
const CAPTURE_HEADER_NAMES = { cookie: 'Cookie', referer: 'Referer', userAgent: 'User-Agent' } as const;

const asCaptureText = (name: keyof typeof CAPTURE_TEXT_LIMITS, value: unknown): string | null => {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`The ${name} must be text.`);
  if (value.length > CAPTURE_TEXT_LIMITS[name]) throw new Error(`The ${name} is too long.`);
  if (CONTROL_CHARACTER.test(value)) throw new Error(`The ${name} has characters that are not allowed.`);
  return value === '' ? null : value;
};

// The extension's request is untrusted until it passes here. Header values must never carry a line break,
// so a captured cookie cannot smuggle a second header into the download request.
export const asCaptureBody = (raw: unknown): CaptureInput => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('The capture must be an object.');
  const body: Record<string, unknown> = { ...raw };
  const allowed = new Set(['url', 'cookie', 'referer', 'userAgent', 'filename', 'size']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('The capture has a field that is not allowed.');
  // A URL parser silently drops line breaks, so they are refused before it sees the link.
  if (typeof body.url === 'string' && CONTROL_CHARACTER.test(body.url)) throw new Error('The link has characters that are not allowed.');
  const url = asUrl(body.url);

  const headers: Record<string, string> = {};
  for (const key of ['cookie', 'referer', 'userAgent'] as const) {
    const text = asCaptureText(key, body[key]);
    if (text !== null) headers[CAPTURE_HEADER_NAMES[key]] = text;
  }

  const size = body.size;
  if (size !== undefined && !(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0)) {
    throw new Error('The size must be a whole number of bytes.');
  }
  return { url, headers, filename: asCaptureText('filename', body.filename), size: size ?? null };
};

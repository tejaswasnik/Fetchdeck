import { assertHttpUrl } from '@fetchdeck/engine';
import { SETTINGS_LIMITS, type SettingsPatch } from '../shared/api';

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

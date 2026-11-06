import { assertHttpUrl } from '@fetchdeck/engine';

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

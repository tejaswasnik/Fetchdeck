import type { StorageArea } from './chromeLike';
import { DEFAULT_THRESHOLD_BYTES } from './shouldCapture';

export type ExtensionSettings = { enabled: boolean; thresholdBytes: number; token: string };

const MB = 1024 * 1024;
const TOKEN_CHARACTERS = /^[A-Za-z0-9_-]+$/;

// Anything missing or damaged in storage falls back to its default, so a bad value can never break capturing.
export const loadSettings = async (storage: StorageArea): Promise<ExtensionSettings> => {
  const saved = await storage.get(['enabled', 'thresholdBytes', 'token']);
  const { enabled, thresholdBytes, token } = saved;
  return {
    enabled: typeof enabled === 'boolean' ? enabled : true,
    thresholdBytes: typeof thresholdBytes === 'number' && Number.isFinite(thresholdBytes) && thresholdBytes > 0 ? thresholdBytes : DEFAULT_THRESHOLD_BYTES,
    token: typeof token === 'string' ? token : '',
  };
};

export const saveSettings = (storage: StorageArea, patch: Partial<ExtensionSettings>): Promise<void> => storage.set(patch);

/** The threshold field is in megabytes. Returns null when the text is not a usable size. */
export const parseThresholdMb = (text: string): number | null => {
  const megabytes = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(megabytes) && megabytes >= 1 && megabytes <= 1_000_000 ? Math.round(megabytes * MB) : null;
};

/** The pairing token as pasted: surrounding spaces and line breaks dropped. Returns null when it cannot be a token. */
export const parseToken = (text: string): string | null => {
  const token = text.trim();
  return token === '' || TOKEN_CHARACTERS.test(token) ? token : null;
};

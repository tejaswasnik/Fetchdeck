import { checkConnection } from './connection';
import { byId } from './dom';
import { DEFAULT_BASE_URL, createFetchdeckClient } from './fetchdeckClient';
import { loadSettings, parseThresholdMb, parseToken, saveSettings } from './settings';

const MB = 1024 * 1024;
const token = byId<HTMLInputElement>('token');
const threshold = byId<HTMLInputElement>('threshold');
const showToken = byId<HTMLButtonElement>('show-token');
const result = byId<HTMLElement>('result');

const say = (text: string, kind: 'ok' | 'bad' | 'plain' = 'plain'): void => {
  result.textContent = text;
  result.dataset.kind = kind;
};

const main = async (): Promise<void> => {
  const saved = await loadSettings(chrome.storage.local);
  token.value = saved.token;
  threshold.value = String(saved.thresholdBytes / MB);
  byId<HTMLInputElement>('port').value = new URL(DEFAULT_BASE_URL).port;

  showToken.addEventListener('click', () => {
    const hidden = token.type === 'password';
    token.type = hidden ? 'text' : 'password';
    showToken.textContent = hidden ? 'Hide' : 'Show';
  });

  byId('save').addEventListener('click', () => {
    const newToken = parseToken(token.value);
    const thresholdBytes = parseThresholdMb(threshold.value);
    if (newToken === null) return say('That does not look like a Fetchdeck token. Copy it again from Fetchdeck, in Settings.', 'bad');
    if (thresholdBytes === null) return say('Enter a size of 1 MB or more.', 'bad');
    void saveSettings(chrome.storage.local, { token: newToken, thresholdBytes }).then(() => say('Saved.', 'ok'));
  });

  // Tests the token as typed, so it can be checked before it is saved.
  byId('test').addEventListener('click', () => {
    const typed = parseToken(token.value);
    if (typed === null || typed === '') return say('Paste the pairing token first.', 'bad');
    say('Checking…');
    const client = createFetchdeckClient({ baseUrl: DEFAULT_BASE_URL, getToken: async () => typed });
    void checkConnection(client).then((check) => say(check.detail ? `${check.text}. ${check.detail}` : check.text, check.state === 'connected' ? 'ok' : 'bad'));
  });
};

void main();

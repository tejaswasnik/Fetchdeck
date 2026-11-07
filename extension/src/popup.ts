import { checkConnection } from './connection';
import { byId } from './dom';
import { DEFAULT_BASE_URL, createFetchdeckClient } from './fetchdeckClient';
import { loadSettings, saveSettings } from './settings';

const toggle = byId<HTMLButtonElement>('enabled');
const dot = byId<HTMLElement>('dot');
const status = byId<HTMLElement>('status');

const showSwitch = (enabled: boolean): void => {
  toggle.setAttribute('aria-checked', String(enabled));
  toggle.classList.toggle('on', enabled);
};

const showStatus = (state: string, text: string): void => {
  dot.className = `dot dot--${state}`;
  status.textContent = text;
};

const main = async (): Promise<void> => {
  const settings = await loadSettings(chrome.storage.local);
  showSwitch(settings.enabled);
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-checked') !== 'true';
    showSwitch(next);
    void saveSettings(chrome.storage.local, { enabled: next });
  });
  byId('open-options').addEventListener('click', (event) => {
    event.preventDefault();
    void chrome.runtime.openOptionsPage();
  });

  if (settings.token === '') {
    showStatus('rejected', 'Not paired yet. Open Options and paste the token.');
    return;
  }
  showStatus('checking', 'Checking…');
  const client = createFetchdeckClient({ baseUrl: DEFAULT_BASE_URL, getToken: async () => settings.token });
  const result = await checkConnection(client);
  showStatus(result.state, result.detail ? `${result.text}. ${result.detail}` : result.text);
};

void main();

import { useEffect, useRef, useState } from 'react';
import { SETTINGS_LIMITS, type ExtensionStatus, type Settings, type SettingsPatch } from '../../shared/api';
import { IconClose } from './Icons';

type SettingsDialogProps = {
  onClose: () => void;
  onSaveDirChanged: () => void;
};

type StepperProps = {
  label: string;
  value: number;
  limits: { min: number; max: number };
  onChange: (value: number) => void;
};

const FOCUSABLE = 'button:not(:disabled), [tabindex="0"]';

const Stepper = ({ label, value, limits, onChange }: StepperProps) => (
  <div className="stepper" role="group" aria-label={label}>
    <button className="iconbtn" aria-label="Decrease" disabled={value <= limits.min} onClick={() => onChange(value - 1)}>-</button>
    <span className="stepper__value" role="spinbutton" aria-label={label} aria-valuenow={value} aria-valuemin={limits.min} aria-valuemax={limits.max}>{value}</span>
    <button className="iconbtn" aria-label="Increase" disabled={value >= limits.max} onClick={() => onChange(value + 1)}>+</button>
  </div>
);

const statusText = (status: ExtensionStatus): string => {
  if (status.state === 'running') return `Running on 127.0.0.1:${status.port}`;
  if (status.state === 'port-in-use') return `Port ${status.port} is in use`;
  return 'Off';
};

const MASKED_TOKEN = '•'.repeat(32);

export const SettingsDialog = ({ onClose, onSaveDirChanged }: SettingsDialogProps) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [extension, setExtension] = useState<ExtensionStatus | null>(null);
  // The token is fetched only when the person asks to see or copy it, and dropped again on Hide.
  const [token, setToken] = useState<string | null>(null);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.downloads
      .getSettings()
      .then((saved) => !cancelled && setSettings(saved))
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the settings');
      });
    window.extension
      .getStatus()
      .then((status) => !cancelled && setExtension(status))
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the extension status');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { if (opener instanceof HTMLElement) opener.focus(); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const keepFocusInside = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const outside = !e.currentTarget.contains(document.activeElement);
    if (e.shiftKey && (outside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (outside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  };

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that setting');
    } finally {
      busy.current = false;
    }
  };

  const update = (patch: SettingsPatch): Promise<void> =>
    run(async () => { setSettings(await window.downloads.updateSettings(patch)); });

  const changeFolder = (): Promise<void> =>
    run(async () => {
      const next = await window.downloads.chooseFolder();
      if (next === null) return;
      setSettings(next);
      onSaveDirChanged();
    });

  const toggleExtension = (enabled: boolean): Promise<void> =>
    run(async () => {
      const next = await window.extension.setEnabled(enabled);
      setExtension(next);
      if (!next.enabled) { setToken(null); setConfirmingRegenerate(false); }
    });

  const toggleToken = (): Promise<void> =>
    run(async () => {
      if (token !== null) { setToken(null); return; }
      setToken(await window.extension.getToken());
    });

  const copyToken = (): Promise<void> =>
    run(async () => {
      if (!navigator.clipboard) throw new Error('Could not copy. Show the token and copy it by hand.');
      await navigator.clipboard.writeText(await window.extension.getToken());
      setCopied(true);
    });

  const regenerateToken = (): Promise<void> =>
    run(async () => {
      const fresh = await window.extension.regenerateToken();
      setConfirmingRegenerate(false);
      setCopied(false);
      if (token !== null) setToken(fresh);
    });

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog settings" role="dialog" aria-label="Settings" ref={dialogRef} onKeyDown={keepFocusInside}>
        <div className="dialog__head">
          <h2>Settings</h2>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><IconClose /></button>
        </div>

        {settings && (
          <div className="settings__rows">
            <div className="settings__row">
              <div className="settings__text">
                <span className="settings__name">Save folder</span>
                <small>Applies to new downloads</small>
              </div>
              <span className="settings__path" title={settings.saveDir}>{settings.saveDir}</span>
              <button className="btn btn--outline btn--small" onClick={() => void changeFolder()}>Change…</button>
            </div>
            <div className="settings__row">
              <div className="settings__text">
                <span className="settings__name">Simultaneous downloads</span>
                <small>Applies right away</small>
              </div>
              <Stepper label="Simultaneous downloads" value={settings.maxConcurrent} limits={SETTINGS_LIMITS.maxConcurrent} onChange={(maxConcurrent) => void update({ maxConcurrent })} />
            </div>
            <div className="settings__row">
              <div className="settings__text">
                <span className="settings__name">Connections per download</span>
                <small>Applies to new downloads</small>
              </div>
              <Stepper label="Connections per download" value={settings.maxSegments} limits={SETTINGS_LIMITS.maxSegments} onChange={(maxSegments) => void update({ maxSegments })} />
            </div>
            <div className="settings__row">
              <div className="settings__text">
                <span className="settings__name">Notifications</span>
                <small>When a download finishes or fails</small>
              </div>
              <button
                className={`switch ${settings.notifications ? 'switch--on' : ''}`}
                role="switch"
                aria-checked={settings.notifications}
                aria-label="Notifications"
                onClick={() => void update({ notifications: !settings.notifications })}
              />
            </div>
            <div className="settings__row">
              <div className="settings__text">
                <span className="settings__name">Browser extension</span>
                <small>{extension ? statusText(extension) : 'Checking…'}</small>
              </div>
              <button
                className={`switch ${extension?.enabled ? 'switch--on' : ''}`}
                role="switch"
                aria-checked={extension?.enabled ?? false}
                aria-label="Browser extension"
                disabled={extension === null}
                onClick={() => extension && void toggleExtension(!extension.enabled)}
              />
            </div>
          </div>
        )}
        {settings && extension?.enabled && (
          <div className="settings__block">
            <span className="settings__name">Pairing token</span>
            <small>Paste it into the extension's options to connect your browser</small>
            <code className="settings__token">{token ?? MASKED_TOKEN}</code>
            <div className="settings__buttons">
              <button className="btn btn--outline btn--small" onClick={() => void toggleToken()}>{token === null ? 'Show' : 'Hide'}</button>
              <button className="btn btn--outline btn--small" onClick={() => void copyToken()}>Copy</button>
              {!confirmingRegenerate && (
                <button className="btn btn--outline btn--small" onClick={() => setConfirmingRegenerate(true)}>Regenerate</button>
              )}
              {copied && <span className="settings__copied" role="status">Copied</span>}
            </div>
            {confirmingRegenerate && (
              <div className="settings__confirm">
                <small>Browsers paired with the old token will stop working until you paste the new one.</small>
                <div className="settings__buttons">
                  <button className="btn btn--outline btn--small" onClick={() => void regenerateToken()}>Yes, regenerate</button>
                  <button className="btn btn--text btn--small" onClick={() => setConfirmingRegenerate(false)}>Keep it</button>
                </div>
              </div>
            )}
          </div>
        )}
        {settings && (
          <p className="settings__help">
            To install: open the extensions page in Chrome or Edge, turn on Developer mode, choose Load unpacked and pick the extension/dist folder.
          </p>
        )}
        {error && <p className="dialog__status dialog__status--error" role="alert">{error}</p>}
      </div>
    </div>
  );
};

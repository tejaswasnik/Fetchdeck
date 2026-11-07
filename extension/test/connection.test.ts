import { describe, expect, it, vi } from 'vitest';
import { checkConnection } from '../src/connection';
import { ClientError } from '../src/fetchdeckClient';

const client = (ping: () => Promise<{ version: string }>) => ({ ping: vi.fn(ping), postCapture: vi.fn(), waitForOutcome: vi.fn() });

describe('checkConnection', () => {
  it('says Connected, with the app version', async () => {
    expect(await checkConnection(client(async () => ({ version: '1.2.0' })))).toEqual({ state: 'connected', text: 'Connected', detail: 'Fetchdeck 1.2.0' });
  });

  it('says Wrong token', async () => {
    const result = await checkConnection(client(async () => { throw new ClientError('wrong-token', 'x'); }));
    expect(result).toMatchObject({ state: 'wrong-token', text: 'Wrong token' });
  });

  it('says Fetchdeck is not running', async () => {
    const result = await checkConnection(client(async () => { throw new ClientError('not-running', 'x'); }));
    expect(result).toMatchObject({ state: 'not-running', text: 'Fetchdeck is not running' });
  });

  it('shows the app\'s own reason when it refuses (a lockout, say)', async () => {
    const result = await checkConnection(client(async () => { throw new ClientError('rejected', 'Too many wrong tokens. Try again in a minute.') }));
    expect(result).toEqual({ state: 'rejected', text: 'Fetchdeck refused the request', detail: 'Too many wrong tokens. Try again in a minute.' });
  });

  it('treats an error it does not know as not running rather than throwing', async () => {
    const result = await checkConnection(client(async () => { throw new TypeError('boom'); }));
    expect(result.state).toBe('not-running');
  });
});

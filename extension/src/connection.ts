import { ClientError, type FetchdeckClient } from './fetchdeckClient';

export type ConnectionState = 'connected' | 'wrong-token' | 'not-running' | 'rejected';
export type ConnectionResult = { state: ConnectionState; text: string; detail?: string };

// The one place the words for "can this browser reach Fetchdeck" live, shared by the popup and the options page.
export const checkConnection = async (client: Pick<FetchdeckClient, 'ping'>): Promise<ConnectionResult> => {
  try {
    const { version } = await client.ping();
    return { state: 'connected', text: 'Connected', detail: `Fetchdeck ${version}` };
  } catch (error) {
    if (error instanceof ClientError && error.kind === 'wrong-token') return { state: 'wrong-token', text: 'Wrong token' };
    if (error instanceof ClientError && error.kind === 'rejected') return { state: 'rejected', text: 'Fetchdeck refused the request', detail: error.message };
    return { state: 'not-running', text: 'Fetchdeck is not running' };
  }
};

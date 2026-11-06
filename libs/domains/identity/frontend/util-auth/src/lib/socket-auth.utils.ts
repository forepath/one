import type { AuthenticationConfig } from './auth-environment';
import { getMtlsAuthorizationHeader } from './mtls-credential';

/** Socket.IO handshake `auth` payload. */
export type SocketAuthPayload = Record<string, unknown>;

/** Socket.IO `auth` option: a static payload, or a callback socket.io-client runs before every (re)connect. */
export type SocketAuthOption = SocketAuthPayload | ((callback: (payload: SocketAuthPayload) => void) => void);

/**
 * Socket.IO `auth` option carrying the console credential (`Authorization`) plus `extra` handshake fields.
 *
 * - mtls: a callback that signs a fresh certificate assertion for every handshake. Assertions are short-lived, so a
 *   static value would fail every automatic reconnect after a couple of minutes.
 * - other modes: the static payload `{ Authorization: authorization, ...extra }` (unchanged behaviour).
 */
export function createSocketAuthOption(
  authConfig: AuthenticationConfig,
  authorization: string,
  extra: SocketAuthPayload = {},
): SocketAuthOption {
  if (authConfig.type !== 'mtls') {
    return { Authorization: authorization, ...extra };
  }

  return (callback) => {
    void getMtlsAuthorizationHeader({
      lifetimeSeconds: authConfig.assertionLifetimeSeconds,
      audience: authConfig.audience,
    })
      .catch(() => null)
      .then((current) => callback(current ? { Authorization: current, ...extra } : { ...extra }));
  };
}

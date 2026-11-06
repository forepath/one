import { getAuthenticationMethod } from './authentication-method';
import { authenticateMtls } from './mtls/mtls-authenticator';
import type { OidcTokenVerifier } from './oidc/oidc-token-verifier.service';
import { secretsEqual } from './secret-compare';

/** Minimal Socket.IO handshake shape (keeps util-auth free of a socket.io dependency). */
export interface ServiceSocketHandshake {
  handshake: {
    headers?: Record<string, unknown>;
    auth?: Record<string, unknown>;
  };
  /** Handshake request; its `socket` carries the TLS client certificate (mtls with the native listener). */
  request?: { socket?: unknown };
}

function readAuthorization(socket: ServiceSocketHandshake): string | undefined {
  const header = socket.handshake.headers?.['authorization'];
  const fromAuth = socket.handshake.auth?.['Authorization'] ?? socket.handshake.auth?.['authorization'];
  const value = typeof header === 'string' ? header : typeof fromAuth === 'string' ? fromAuth : undefined;

  return value?.trim() || undefined;
}

/**
 * Authenticates a service-to-service Socket.IO handshake with the same credentials as the HTTP API of apps without
 * user accounts (agent-manager): `Bearer|ApiKey <STATIC_API_KEY>` in api-key mode, a trusted client certificate (TLS
 * handshake or `Certificate <assertion>`, like `HybridAuthGuard`) in mtls mode, or an OIDC access token (verified
 * like `OidcAuthGuard`, incl. audience / authorized-party rules) in oidc mode. Any other mode is rejected.
 * Returns `true` only for an authenticated handshake (fail-closed).
 */
export async function authenticateServiceSocket(
  socket: ServiceSocketHandshake,
  oidcVerifier?: Pick<OidcTokenVerifier, 'verifyAccessToken'> | null,
): Promise<boolean> {
  const authorization = readAuthorization(socket);
  let method: string;

  try {
    method = getAuthenticationMethod();
  } catch {
    return false;
  }

  // mtls: a TLS client certificate needs no Authorization value.
  if (method === 'mtls') {
    try {
      return authenticateMtls({ authorization, transportSocket: socket.request?.socket }).ok;
    } catch {
      return false;
    }
  }

  if (!authorization) {
    return false;
  }

  const [scheme, credential, ...rest] = authorization.split(' ');

  if (!credential || rest.length > 0) {
    return false;
  }

  if (method === 'api-key') {
    const staticApiKey = process.env.STATIC_API_KEY;

    return !!staticApiKey && (scheme === 'Bearer' || scheme === 'ApiKey') && secretsEqual(credential, staticApiKey);
  }

  if (method === 'oidc') {
    if (scheme?.toLowerCase() !== 'bearer' || !oidcVerifier) {
      return false;
    }

    try {
      await oidcVerifier.verifyAccessToken(credential);

      return true;
    } catch {
      return false;
    }
  }

  return false;
}

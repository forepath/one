import { createMtlsAuthorizationHeader } from '@forepath/identity/backend';
import { BadRequestException } from '@nestjs/common';

/** Client fields needed to authenticate against an agent-manager running `AUTHENTICATION_METHOD=mtls`. */
export interface ClientMtlsCredential {
  endpoint: string;
  mtlsCertificate?: string | null;
  mtlsPrivateKey?: string | null;
}

/**
 * `Authorization` value for one request / websocket handshake to an mtls agent-manager: a fresh, short-lived
 * certificate assertion signed with the client's stored key, with `aud` set to the manager origin (managers may
 * require it via `MTLS_ASSERTION_AUDIENCE`).
 */
export function createClientMtlsAuthorizationHeader(client: ClientMtlsCredential): string {
  if (!client.mtlsCertificate || !client.mtlsPrivateKey) {
    throw new BadRequestException('Client certificate is not configured for this client');
  }

  let audience: string | undefined;

  try {
    audience = new URL(client.endpoint).origin;
  } catch {
    audience = undefined;
  }

  try {
    return createMtlsAuthorizationHeader({
      certificateChain: client.mtlsCertificate,
      privateKey: client.mtlsPrivateKey,
      audience,
    });
  } catch {
    throw new BadRequestException('Client certificate of this client cannot be used');
  }
}

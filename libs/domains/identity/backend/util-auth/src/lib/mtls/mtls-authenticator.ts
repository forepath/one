import { verifyMtlsAssertion } from './mtls-assertion';
import { type MtlsClientPrincipal, MtlsVerificationError, verifyClientCertificateChain } from './mtls-certificate';
import { getTlsPeerCertificateChain } from './mtls-transport';
import { getMtlsConfig, MTLS_AUTHORIZATION_SCHEME, type MtlsConfig } from './mtls.config';

/** Where a request's client certificate may come from. */
export interface MtlsCredentials {
  /** `Authorization` header / socket handshake value (`Certificate <assertion>`). */
  authorization?: unknown;
  /** Underlying connection (`req.socket`, `socket.request.socket`): TLS client certificate, when presented. */
  transportSocket?: unknown;
}

export type MtlsAuthenticationResult =
  | { ok: true; principal: MtlsClientPrincipal }
  | {
      ok: false;
      /** Whether any client certificate was presented (TLS or assertion) — for the error message. */
      presented: boolean;
      /** Rejection reason for logs only; never send it to the client. */
      reason: string;
    };

/** Extracts the assertion of an `Authorization: Certificate <assertion>` value (scheme is case-insensitive). */
export function readMtlsAssertionFromAuthorization(authorization: unknown): string | undefined {
  if (typeof authorization !== 'string') {
    return undefined;
  }

  const parts = authorization.trim().split(' ');

  if (parts.length !== 2 || parts[0].toLowerCase() !== MTLS_AUTHORIZATION_SCHEME.toLowerCase() || !parts[1]) {
    return undefined;
  }

  return parts[1];
}

/**
 * Authenticates a request / socket handshake in `AUTHENTICATION_METHOD=mtls`: a client certificate presented in the
 * TLS handshake, or a certificate assertion in the `Authorization` header. Either valid credential authenticates (a
 * browser may present an unrelated TLS certificate and still send a valid assertion); nothing else, e.g. a bearer
 * token, is ever accepted (fail-closed).
 *
 * @throws MtlsConfigurationError when the mTLS configuration is missing or invalid
 */
export function authenticateMtls(
  credentials: MtlsCredentials,
  options: { config?: MtlsConfig; now?: Date } = {},
): MtlsAuthenticationResult {
  const config = options.config ?? getMtlsConfig();
  const now = options.now ?? new Date();
  const reasons: string[] = [];
  const tlsChain = getTlsPeerCertificateChain(credentials.transportSocket);

  if (tlsChain) {
    try {
      return { ok: true, principal: verifyClientCertificateChain(tlsChain, config, 'tls', now) };
    } catch (error) {
      reasons.push(`tls: ${describe(error)}`);
    }
  }

  const assertion = readMtlsAssertionFromAuthorization(credentials.authorization);

  if (assertion) {
    try {
      return { ok: true, principal: verifyMtlsAssertion(assertion, config, now) };
    } catch (error) {
      reasons.push(`assertion: ${describe(error)}`);
    }
  }

  if (reasons.length === 0) {
    return { ok: false, presented: false, reason: 'no client certificate presented' };
  }

  return { ok: false, presented: true, reason: reasons.join('; ') };
}

function describe(error: unknown): string {
  if (error instanceof MtlsVerificationError) {
    return error.message;
  }

  return 'verification failed';
}

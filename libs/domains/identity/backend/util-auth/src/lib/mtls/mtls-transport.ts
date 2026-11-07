import { X509Certificate } from 'node:crypto';

import { getAuthenticationMethod } from '../authentication-method';

import { MTLS_MAX_CHAIN_LENGTH, MtlsConfigurationError, getMtlsConfig, readPemSetting } from './mtls.config';

/** Minimal shape of a Node `tls.TLSSocket` (keeps util-auth free of transport typings). */
interface PeerCertificateLike {
  raw?: Buffer;
  issuerCertificate?: PeerCertificateLike;
}

interface TlsSocketLike {
  encrypted?: boolean;
  getPeerCertificate(detailed: true): PeerCertificateLike | null | undefined;
}

function isTlsSocket(socket: unknown): socket is TlsSocketLike {
  return (
    !!socket &&
    typeof socket === 'object' &&
    (socket as { encrypted?: unknown }).encrypted === true &&
    typeof (socket as { getPeerCertificate?: unknown }).getPeerCertificate === 'function'
  );
}

/**
 * Certificate chain (`[leaf, ...issuers]`) the peer presented in the TLS handshake, or `null` when the connection is
 * not TLS or no client certificate was sent. The chain is NOT trusted yet: pass it to `verifyClientCertificateChain`.
 * Possession of the leaf's private key is proven by the TLS handshake (CertificateVerify).
 */
export function getTlsPeerCertificateChain(socket: unknown): X509Certificate[] | null {
  if (!isTlsSocket(socket)) {
    return null;
  }

  let peer: PeerCertificateLike | null | undefined;

  try {
    peer = socket.getPeerCertificate(true);
  } catch {
    return null;
  }

  const chain: X509Certificate[] = [];
  const seen = new Set<PeerCertificateLike>();

  // Node links issuers through `issuerCertificate`; a self-signed root references itself.
  while (peer?.raw && !seen.has(peer) && chain.length <= MTLS_MAX_CHAIN_LENGTH) {
    seen.add(peer);

    try {
      chain.push(new X509Certificate(peer.raw));
    } catch {
      return null;
    }

    peer = peer.issuerCertificate;
  }

  return chain.length > 0 ? chain : null;
}

/** HTTPS server options for `NestFactory.create(…, { httpsOptions })`. */
export interface MtlsHttpsServerOptions {
  cert: string;
  key: string;
  ca: string;
  requestCert: true;
  rejectUnauthorized: false;
  minVersion: 'TLSv1.2';
}

/**
 * Opt-in native TLS listener that requests client certificates (`AUTHENTICATION_METHOD=mtls` only).
 * Configured with `MTLS_SERVER_CERT` / `MTLS_SERVER_KEY` (or the `_FILE` variants); returns `undefined` when unset
 * (plain HTTP, e.g. behind a TLS-terminating reverse proxy — clients then use certificate assertions).
 *
 * The handshake does not reject unknown or missing certificates (`rejectUnauthorized: false`): health checks and
 * assertion-based clients must still connect, and `HybridAuthGuard` / the socket auth reject every request without a
 * valid certificate.
 */
export function getMtlsHttpsOptions(
  env: Record<string, string | undefined> = process.env,
): MtlsHttpsServerOptions | undefined {
  const cert = readPemSetting(env, 'MTLS_SERVER_CERT');
  const key = readPemSetting(env, 'MTLS_SERVER_KEY');

  if (!cert && !key) {
    return undefined;
  }

  if (getAuthenticationMethod() !== 'mtls') {
    throw new MtlsConfigurationError('MTLS_SERVER_CERT / MTLS_SERVER_KEY require AUTHENTICATION_METHOD=mtls.');
  }

  if (!cert || !key) {
    throw new MtlsConfigurationError('MTLS_SERVER_CERT and MTLS_SERVER_KEY must be set together.');
  }

  return {
    cert,
    key,
    ca: getMtlsConfig().trustAnchorsPem,
    requestCert: true,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
  };
}

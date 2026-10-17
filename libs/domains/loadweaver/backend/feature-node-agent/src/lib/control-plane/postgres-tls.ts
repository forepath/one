import { createPrivateKey, X509Certificate } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { POSTGRES_TLS_SERVER_NAME, type PostgresTls } from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Postgres TLS on a member (3.2): Spilo serves a server certificate from the cluster CA, and the API on the member
 * connects with TLS and verifies it. The control plane issues a fresh certificate with every push of the role; the
 * agent keeps the one it has (no Spilo restart) until it needs another: none yet, another CA, an address of the
 * member isn't in it, or only a third of its lifetime is left.
 */

const RENEW_AT_REMAINING_FRACTION = 1 / 3;

/** Whether a certificate / key pair is usable: chains to its CA, key matches, valid now, has the API's name. */
export function postgresTlsProblem(tls: PostgresTls, now: Date = new Date()): string | null {
  try {
    const cert = new X509Certificate(tls.certificatePem);
    const ca = new X509Certificate(tls.caCertificatePem);

    if (!cert.checkIssued(ca) || !cert.verify(ca.publicKey)) return 'not issued by the CA';

    if (!cert.checkPrivateKey(createPrivateKey(tls.privateKeyPem))) return 'key does not match';

    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) return 'not valid now';

    if (!cert.checkHost(POSTGRES_TLS_SERVER_NAME, { wildcards: false })) return `no ${POSTGRES_TLS_SERVER_NAME}`;

    return null;
  } catch (error) {
    return `unreadable (${error instanceof Error ? error.message : String(error)})`;
  }
}

function ipAddresses(cert: X509Certificate): string[] {
  return (cert.subjectAltName ?? '')
    .split(', ')
    .filter((n) => n.startsWith('IP Address:'))
    .map((n) => n.slice('IP Address:'.length));
}

/**
 * Which certificate Spilo should serve: the installed one unless the offered one is needed (see above). The member's
 * addresses are the control plane's view: the ones in the offered certificate.
 */
export function choosePostgresTls(
  installed: PostgresTls | null,
  offered: PostgresTls | undefined,
  now: Date = new Date(),
): PostgresTls | null {
  if (!offered || postgresTlsProblem(offered, now)) return installed;

  if (!installed || postgresTlsProblem(installed, now)) return offered;

  if (installed.caCertificatePem.trim() !== offered.caCertificatePem.trim()) return offered;

  const cert = new X509Certificate(installed.certificatePem);

  if (ipAddresses(new X509Certificate(offered.certificatePem)).some((ip) => !cert.checkIP(ip))) return offered;

  const from = new Date(cert.validFrom).getTime();
  const to = new Date(cert.validTo).getTime();

  return (to - now.getTime()) / Math.max(1, to - from) < RENEW_AT_REMAINING_FRACTION ? offered : installed;
}

const FILES = { certificatePem: 'server.crt', privateKeyPem: 'server.key', caCertificatePem: 'ca.crt' } as const;

async function readInstalled(dir: string): Promise<PostgresTls | null> {
  try {
    const [certificatePem, privateKeyPem, caCertificatePem] = await Promise.all(
      Object.values(FILES).map((f) => readFile(join(dir, f), 'utf8')),
    );

    return { certificatePem, privateKeyPem, caCertificatePem };
  } catch {
    return null;
  }
}

/**
 * Keeps the member's Postgres certificate in `<stateDir>/postgres-tls` (0600) and returns what Spilo serves, or
 * null before the control plane sent the first one (bootstrap: Spilo's self-signed certificate).
 */
export async function ensurePostgresTls(
  stateDir: string,
  offered: PostgresTls | undefined,
  now: Date = new Date(),
): Promise<{ tls: PostgresTls | null; replaced: boolean }> {
  const dir = join(stateDir, 'postgres-tls');
  const installed = await readInstalled(dir);
  const chosen = choosePostgresTls(installed, offered, now);

  if (!chosen || chosen === installed) return { tls: chosen, replaced: false };

  await mkdir(dir, { recursive: true, mode: 0o700 });

  for (const [field, file] of Object.entries(FILES) as [keyof PostgresTls, string][]) {
    await writeFile(join(dir, `${file}.new`), chosen[field], { mode: 0o600 });
    await rename(join(dir, `${file}.new`), join(dir, file));
  }

  return { tls: chosen, replaced: true };
}

/** Spilo writes the certificate and key from these to its own files (owned by postgres) at start. */
export function spiloTlsEnvironment(tls: PostgresTls | null | undefined): Record<string, string> {
  return tls ? { SSL_CERTIFICATE: tls.certificatePem, SSL_PRIVATE_KEY: tls.privateKeyPem } : {};
}

/**
 * The API's database TLS: verified against the cluster CA and the shared name once the member has its certificate;
 * before (bootstrap, Spilo's self-signed certificate) encrypted without verification.
 */
export function apiDatabaseTlsEnvironment(tls: PostgresTls | null | undefined): Record<string, string> {
  return tls
    ? { DB_SSL_MODE: 'verify-full', DB_SSL_CA: tls.caCertificatePem, DB_SSL_SERVERNAME: POSTGRES_TLS_SERVER_NAME }
    : { DB_SSL_MODE: 'require' };
}

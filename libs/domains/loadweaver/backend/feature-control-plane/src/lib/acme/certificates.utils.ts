import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';

/** Renew ACME certificates this long before they expire (Let's Encrypt recommends a third of 90 days). */
export const RENEW_BEFORE_MS = 30 * 86_400_000;
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 24 * 3_600_000;

/** Stable, readable id for a certificate of one host. */
export function certificateId(host: string): string {
  const slug = host
    .replace(/^\*\./, 'wildcard.')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return slug.length <= 64
    ? slug
    : `${slug.slice(0, 55)}-${createHash('sha256').update(host).digest('hex').slice(0, 8)}`;
}

/** Whether a certificate name covers a host: exact, or `*.example.com` for exactly one label. */
export function covers(name: string, host: string): boolean {
  if (name === host) return true;

  if (!name.startsWith('*.')) return false;

  const rest = host.slice(host.indexOf('.') + 1);

  return host.includes('.') && rest === name.slice(2) && !host.slice(0, host.indexOf('.')).includes('*');
}

export interface StoredCertificate {
  id: string;
  names: string[];
  source: 'acme' | 'custom';
  certificatePem: string | null;
  notAfter: Date | null;
}

/** The certificate a host is served with: valid, covering; uploaded ones before ACME, exact before wildcard. */
export function pickCertificate<C extends StoredCertificate>(
  host: string,
  certificates: readonly C[],
  now: Date,
): C | undefined {
  return certificates
    .filter((c) => c.certificatePem && c.notAfter && c.notAfter > now && c.names.some((n) => covers(n, host)))
    .sort(
      (a, b) =>
        Number(b.source === 'custom') - Number(a.source === 'custom') ||
        Number(b.names.includes(host)) - Number(a.names.includes(host)) ||
        (b.notAfter as Date).getTime() - (a.notAfter as Date).getTime(),
    )[0];
}

export function renewalDue(
  certificate: Pick<StoredCertificate, 'certificatePem' | 'notAfter'> | undefined,
  now: Date,
): boolean {
  return (
    !certificate?.certificatePem ||
    !certificate.notAfter ||
    certificate.notAfter.getTime() - now.getTime() < RENEW_BEFORE_MS
  );
}

export function nextAttempt(failures: number, now: Date): Date {
  return new Date(now.getTime() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1)));
}

/** Checks an uploaded certificate (3.6): parseable, matching key, not expired; returns its DNS names. */
export function validateUploadedCertificate(
  certificatePem: string,
  privateKeyPem: string,
  now: Date,
): { names: string[]; notAfter: Date } {
  let cert: X509Certificate;

  try {
    cert = new X509Certificate(certificatePem);
  } catch {
    throw new Error('the certificate is not a valid PEM certificate');
  }

  let key;

  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error('the private key is not a valid PEM key');
  }

  if (!cert.checkPrivateKey(key)) throw new Error('the private key does not belong to the certificate');

  const notAfter = new Date(cert.validTo);

  if (notAfter <= now) throw new Error('the certificate has expired');

  const names = (cert.subjectAltName ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice(4).toLowerCase());

  if (names.length === 0) throw new Error('the certificate has no DNS names');

  return { names, notAfter };
}

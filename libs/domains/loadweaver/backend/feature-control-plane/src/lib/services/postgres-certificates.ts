import { createHash, X509Certificate } from 'node:crypto';

import type { PostgresTls } from '@forepath/loadweaver/shared/util-agent-protocol';

/**
 * Members' Postgres server certificates (3.2), kept per member so every push (from any replica) carries the same
 * certificate. Reused while it covers the member and more than a third of its lifetime is left — the same threshold
 * at which the agent switches to an offered certificate — and renewed otherwise. A daily timer re-pushes to members
 * whose stored certificate passed two thirds of its lifetime, so members without other changes renew too.
 */

/** Renewal starts once two thirds of the lifetime passed (a third left, like the agent's switch-over). */
export const POSTGRES_CERTIFICATE_RENEW_AT_ELAPSED = 2 / 3;

export interface StoredPostgresCertificate {
  nodeName: string;
  serial: string;
  address: string;
  certificatePem: string;
  privateKeyPem: string;
  caFingerprint: string;
  notBefore: Date;
  notAfter: Date;
}

export interface PostgresCertificateStore {
  load(nodeName: string): Promise<StoredPostgresCertificate | null>;
  /**
   * Stores `next` in place of `previous` (null: none yet) unless another writer replaced it first, and returns what
   * is stored afterwards — concurrent pushes from several replicas agree on one certificate.
   */
  replace(
    next: StoredPostgresCertificate,
    previous: StoredPostgresCertificate | null,
  ): Promise<StoredPostgresCertificate>;
}

export function caFingerprint(caCertificatePem: string): string {
  return createHash('sha256').update(caCertificatePem.trim()).digest('hex');
}

/** Fraction of the certificate's lifetime passed at `now` (≥ 1 once expired). */
export function elapsedFraction(stored: Pick<StoredPostgresCertificate, 'notBefore' | 'notAfter'>, now: Date): number {
  const from = stored.notBefore.getTime();
  const to = stored.notAfter.getTime();

  return (now.getTime() - from) / Math.max(1, to - from);
}

/** Two thirds of the lifetime passed (or expired): the next push renews it. */
export function postgresCertificateDue(
  stored: Pick<StoredPostgresCertificate, 'notBefore' | 'notAfter'>,
  now: Date,
): boolean {
  return elapsedFraction(stored, now) >= POSTGRES_CERTIFICATE_RENEW_AT_ELAPSED;
}

/** Why the stored certificate can't be pushed again (null: reuse it). */
export function postgresCertificateProblem(
  stored: StoredPostgresCertificate | null,
  address: string,
  caCertificatePem: string,
  now: Date,
): string | null {
  if (!stored) return 'none issued yet';

  if (stored.caFingerprint !== caFingerprint(caCertificatePem)) return 'issued by another CA';

  if (stored.address !== address) return `issued for ${stored.address}, member address is ${address}`;

  if (now.getTime() < stored.notBefore.getTime()) return 'not valid yet';

  if (postgresCertificateDue(stored, now)) return 'less than a third of its lifetime left';

  return null;
}

/** The stored form of a freshly issued certificate. */
export function toStoredPostgresCertificate(
  nodeName: string,
  address: string,
  tls: PostgresTls,
): StoredPostgresCertificate {
  const cert = new X509Certificate(tls.certificatePem);

  return {
    nodeName,
    serial: cert.serialNumber.toLowerCase().slice(0, 64),
    address,
    certificatePem: tls.certificatePem,
    privateKeyPem: tls.privateKeyPem,
    caFingerprint: caFingerprint(tls.caCertificatePem),
    notBefore: new Date(cert.validFrom),
    notAfter: new Date(cert.validTo),
  };
}

/**
 * The certificate to push to a member: the stored one while it is usable, else a new one from `issue`, stored with
 * compare-and-swap (whichever replica wins, every replica then pushes the winner).
 */
export async function memberPostgresCertificate(
  store: PostgresCertificateStore,
  issue: () => Promise<PostgresTls>,
  nodeName: string,
  address: string,
  caCertificatePem: string,
  now: Date = new Date(),
): Promise<{ tls: PostgresTls; issued: boolean }> {
  const stored = await store.load(nodeName);

  if (stored && !postgresCertificateProblem(stored, address, caCertificatePem, now))
    return {
      tls: {
        certificatePem: stored.certificatePem,
        privateKeyPem: stored.privateKeyPem,
        caCertificatePem,
      },
      issued: false,
    };

  const winner = await store.replace(toStoredPostgresCertificate(nodeName, address, await issue()), stored);

  return {
    tls: { certificatePem: winner.certificatePem, privateKeyPem: winner.privateKeyPem, caCertificatePem },
    issued: true,
  };
}

/** Members whose stored certificate is due (renewal timer): only current, not-left control-plane members. */
export function membersDueForRenewal(
  stored: readonly Pick<StoredPostgresCertificate, 'nodeName' | 'notBefore' | 'notAfter'>[],
  members: ReadonlySet<string>,
  now: Date,
): string[] {
  return stored
    .filter((s) => members.has(s.nodeName) && postgresCertificateDue(s, now))
    .map((s) => s.nodeName)
    .sort();
}

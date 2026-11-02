import { X509Certificate } from 'node:crypto';

import { createServerCsr, generateKeyPair } from '@forepath/loadweaver/shared/util-pki';

import { AcmeError, type AcmeAuthorization, type AcmeClient, type AcmeOrder } from './acme-client';

export interface PresentedChallenge {
  type: 'http-01' | 'dns-01';
  /** The DNS name being validated (without `*.`). */
  name: string;
  token: string;
  keyAuthorization: string;
  /** DNS-01: TXT value of `_acme-challenge.<name>`. */
  dnsValue: string;
}

export interface ChallengeHooks {
  /** Publishes the challenges (ingress / DNS) and resolves once they are served. */
  present(challenges: PresentedChallenge[]): Promise<void>;
  /** Always called at the end, also on failure. */
  cleanup(challenges: PresentedChallenge[]): Promise<void>;
}

export interface ObtainedCertificate {
  certificatePem: string;
  privateKeyPem: string;
  notAfter: Date;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  failed: (value: T) => boolean,
  what: string,
  timeoutMs: number,
  pollMs: number,
): Promise<T> {
  const start = Date.now();

  for (;;) {
    const value = await read();

    if (done(value)) return value;

    if (failed(value)) throw new AcmeError(`${what} failed: ${JSON.stringify(value).slice(0, 500)}`, 400);

    if (Date.now() - start > timeoutMs) throw new AcmeError(`${what} timed out`, 408);

    await sleep(pollMs);
  }
}

/**
 * Issues a certificate for the names (3.6): HTTP-01 through the ingress where possible, DNS-01 for wildcards (and
 * when HTTP-01 isn't offered). The private key is generated here and never leaves the control plane unencrypted.
 */
export async function obtainCertificate(
  client: AcmeClient,
  names: string[],
  hooks: ChallengeHooks,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ObtainedCertificate> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollMs = options.pollMs ?? 2_000;
  let order: AcmeOrder = await client.newOrder(names);
  const authorizations = await Promise.all(
    order.authorizations.map(async (url) => ({ url, authz: await client.authorization(url) })),
  );
  const pending = authorizations.filter((a) => a.authz.status === 'pending');
  const chosen = pending.map(({ url, authz }) => {
    const http = authz.challenges.find((c) => c.type === 'http-01');
    const dns = authz.challenges.find((c) => c.type === 'dns-01');
    const challenge = authz.wildcard ? dns : (http ?? dns);

    if (!challenge) throw new AcmeError(`no usable challenge for ${authz.identifier.value}`, 400);

    return { url, authz, challenge };
  });
  const presented: PresentedChallenge[] = chosen.map(({ authz, challenge }) => ({
    type: challenge.type as 'http-01' | 'dns-01',
    name: authz.identifier.value,
    token: challenge.token,
    keyAuthorization: client.keyAuthorization(challenge.token),
    dnsValue: client.dnsTxtValue(challenge.token),
  }));

  try {
    if (presented.length > 0) {
      await hooks.present(presented);

      for (const { challenge } of chosen) await client.respond(challenge.url);

      for (const { url } of chosen) {
        await until<AcmeAuthorization>(
          () => client.authorization(url),
          (a) => a.status === 'valid',
          (a) => a.status === 'invalid' || a.status === 'expired' || a.status === 'revoked',
          `authorization ${url}`,
          timeoutMs,
          pollMs,
        );
      }
    }

    // Only an order we finalize ourselves carries a certificate for our key.
    order = await until(
      () => client.order(order.url),
      (o) => o.status === 'ready',
      (o) => o.status !== 'pending' && o.status !== 'ready',
      'order',
      timeoutMs,
      pollMs,
    );

    const keys = await generateKeyPair();

    order = await client.finalize(order, (await createServerCsr(keys, names)).der);

    order = await until(
      () => client.order(order.url),
      (o) => o.status === 'valid' && !!o.certificate,
      (o) => o.status === 'invalid',
      'finalization',
      timeoutMs,
      pollMs,
    );

    const certificatePem = await client.certificate(order.certificate as string);
    const leaf = new X509Certificate(certificatePem);

    return { certificatePem, privateKeyPem: keys.privateKeyPem, notAfter: new Date(leaf.validTo) };
  } finally {
    await hooks.cleanup(presented).catch(() => undefined);
  }
}

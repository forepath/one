import { Injectable } from '@nestjs/common';

const RIPESTAT = 'https://stat.ripe.net/data/rpki-validation/data.json';
const TIMEOUT_MS = 5_000;
const MAX_CHECKS = 32;

export type RoaStatus = 'valid' | 'invalid' | 'invalid_asn' | 'invalid_length' | 'unknown' | 'error';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * ROA check at plan time (3.27): asks RIPEstat whether the origin ASN may announce each prefix. Only a fixed host
 * is contacted; failures become "could not verify" warnings and never block a plan.
 */
@Injectable()
export class RpkiCheckService {
  fetchImpl: FetchLike = (url, init) => fetch(url, init);

  async status(asn: number, prefix: string): Promise<RoaStatus> {
    try {
      const res = await this.fetchImpl(`${RIPESTAT}?resource=AS${asn}&prefix=${encodeURIComponent(prefix)}`, {
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) return 'error';

      const status = ((await res.json()) as { data?: { status?: string } }).data?.status;

      return status === 'valid' ||
        status === 'invalid' ||
        status === 'invalid_asn' ||
        status === 'invalid_length' ||
        status === 'unknown'
        ? status
        : 'error';
    } catch {
      return 'error';
    }
  }

  /** Warnings for the plan; at most a bounded number of lookups per plan. */
  async warnings(asn: number | undefined, prefixes: readonly string[]): Promise<string[]> {
    if (!asn) return [];

    const unique = [...new Set(prefixes)].slice(0, MAX_CHECKS);
    const results = await Promise.all(
      unique.map(async (prefix) => ({ prefix, status: await this.status(asn, prefix) })),
    );

    return results
      .filter((r) => r.status !== 'valid')
      .map((r) =>
        r.status === 'unknown'
          ? `${r.prefix}: no ROA for AS${asn}; networks with RPKI filtering may drop it once a covering ROA exists elsewhere`
          : r.status === 'error'
            ? `${r.prefix}: ROA status could not be verified`
            : `${r.prefix}: RPKI ${r.status.replace('_', ' ')} for AS${asn}; most networks will reject the announcement`,
      );
  }
}

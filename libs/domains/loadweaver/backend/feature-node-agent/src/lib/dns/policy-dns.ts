import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  DNS_CLASS_IN,
  DNS_TYPE_A,
  DNS_TYPE_AAAA,
  RCODE_NOERROR,
  RCODE_NXDOMAIN,
  RCODE_REFUSED,
  type DnsQuery,
} from './dns-message';

export type DnsDecision = { kind: 'answer'; rcode: number; addresses: string[] } | { kind: 'forward' };

/**
 * Decides a query (3.4): names under the cluster domain are answered only for callers whose policies allow
 * the service; everything else under the domain is NXDOMAIN so a caller can't learn what exists.
 * Other names are forwarded upstream.
 */
export function decide(dns: NodeNetworkConfig['dns'], client: string, query: DnsQuery): DnsDecision {
  const domain = dns.domain;
  const name = query.question.name;
  const suffix = `.${domain}`;

  if (name !== domain && !name.endsWith(suffix)) return { kind: 'forward' };

  if (query.question.class !== DNS_CLASS_IN) return { kind: 'answer', rcode: RCODE_REFUSED, addresses: [] };

  const visible = dns.visibility[client] ?? [];
  const record = visible.includes(name) ? dns.records.find((r) => r.name === name) : undefined;

  if (!record) return { kind: 'answer', rcode: RCODE_NXDOMAIN, addresses: [] };

  if (query.question.type !== DNS_TYPE_A && query.question.type !== DNS_TYPE_AAAA) {
    return { kind: 'answer', rcode: RCODE_NOERROR, addresses: [] };
  }

  const v6 = query.question.type === DNS_TYPE_AAAA;

  return { kind: 'answer', rcode: RCODE_NOERROR, addresses: record.addresses.filter((a) => a.includes(':') === v6) };
}

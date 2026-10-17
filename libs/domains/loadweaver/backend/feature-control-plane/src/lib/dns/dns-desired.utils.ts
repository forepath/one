import { mustParseIp } from '@forepath/loadweaver/shared/util-network';

import type { FailoverAnswer } from './dns-failover.utils';
import type { SteeredHost } from './steering.utils';
import type { DnsRecordSpec, DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';

export type DesiredRecordType = DnsRecordSpec['type'];

/** One record set the cluster wants published (3.15): name + type → values. */
export interface DesiredRecord {
  /** `DnsZone` resource name. */
  zone: string;
  /** Fully qualified, without trailing dot. */
  fqdn: string;
  type: DesiredRecordType;
  values: string[];
  ttl: number;
  priority?: number;
  /** Where it comes from, for the plan. */
  source: string;
}

export interface DnsDesiredState {
  records: DesiredRecord[];
  errors: string[];
  warnings: string[];
  /** Hosts with per-client answers (3.28), served through views by hosted bind9. */
  steered?: SteeredHost[];
}

/** Ownership marker next to every name Loadweaver manages, like external-dns' TXT registry (3.15). */
export const OWNERSHIP_PREFIX = '_loadweaver';

export function ownershipName(fqdn: string): string {
  return `${OWNERSHIP_PREFIX}.${fqdn.replace(/^\*\./, 'wildcard.')}`;
}

/** Ownership TXT content: the cluster and the record types it manages at that name. */
export function ownershipValue(clusterId: string, types: readonly string[]): string {
  return `heritage=loadweaver,cluster=${clusterId},types=${[...new Set(types)].sort().join('+')}`;
}

/** The types a cluster owns at a name, from the ownership TXT values there (none = not ours). */
export function ownedTypes(values: readonly string[], clusterId: string): string[] | null {
  for (const raw of values) {
    const value = raw.replace(/^"|"$/g, '');
    const match = /^heritage=loadweaver,cluster=([^,]+),types=([A-Z+]*)$/.exec(value);

    if (match && match[1] === clusterId) return match[2] ? match[2].split('+') : [];
  }

  return null;
}

/** The managed zone a name belongs to: the longest zone that is a suffix of it. */
export function zoneFor(fqdn: string, zones: ReadonlyMap<string, DnsZoneSpec>): string | undefined {
  let best: { name: string; length: number } | undefined;

  for (const [name, spec] of zones) {
    if ((fqdn === spec.zone || fqdn.endsWith(`.${spec.zone}`)) && (!best || spec.zone.length > best.length))
      best = { name, length: spec.zone.length };
  }

  return best?.name;
}

export interface DeclaredRecord {
  name: string;
  project?: string;
  spec: DnsRecordSpec;
}

/**
 * Everything the cluster wants in DNS: declared records and the ingress hostnames pointing at the ingress addresses.
 * Two sources for the same name and type are an error; ingress hostnames outside every managed zone are a warning.
 */
export function desiredDnsRecords(
  zones: ReadonlyMap<string, DnsZoneSpec>,
  declared: readonly DeclaredRecord[],
  ingressHosts: readonly string[],
  ingressAddresses: readonly string[],
  failovers: readonly FailoverAnswer[] = [],
): DnsDesiredState {
  const records = new Map<string, DesiredRecord>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const add = (record: DesiredRecord) => {
    const key = `${record.fqdn} ${record.type}`;
    const existing = records.get(key);

    if (existing)
      errors.push(`${record.type} ${record.fqdn} is defined by both ${existing.source} and ${record.source}`);
    else records.set(key, record);
  };

  for (const r of declared) {
    const zone = zones.get(r.spec.zone);

    if (!zone) {
      errors.push(`DnsRecord ${r.name}: zone ${r.spec.zone} does not exist`);
      continue;
    }

    // Zones are the cluster's: a project's records can't redelegate or take over the apex (NS, SOA-level names).
    if (r.project && (r.spec.type === 'NS' || r.spec.name === '@')) {
      errors.push(
        `DnsRecord ${r.project}/${r.name}: project records can't be NS records or sit at the zone apex; ask a cluster admin`,
      );
      continue;
    }

    const fqdn = r.spec.name === '@' ? zone.zone : `${r.spec.name}.${zone.zone}`;

    add({
      zone: r.spec.zone,
      fqdn,
      type: r.spec.type,
      values: [...r.spec.values].sort(),
      ttl: r.spec.ttl ?? zone.defaultTtl,
      ...(r.spec.priority !== undefined ? { priority: r.spec.priority } : {}),
      source: `DnsRecord ${r.project ? `${r.project}/` : ''}${r.name}`,
    });
  }

  // DNS failover answers (3.28) replace the plain ingress records of their hostname.
  for (const f of failovers) {
    const zone = zoneFor(f.host, zones);

    if (!zone) {
      errors.push(`DnsFailover ${f.name}: ${f.host} is in no managed zone`);
      continue;
    }

    for (const [type, values] of [
      ['A', f.addresses.filter((a) => !a.includes(':')).sort()],
      ['AAAA', f.addresses.filter((a) => a.includes(':')).sort()],
    ] as const) {
      if (values.length)
        add({ zone, fqdn: f.host, type, values: [...values], ttl: f.ttl, source: `DnsFailover ${f.name}` });
    }
  }

  const failoverHosts = new Set(failovers.map((f) => f.host));
  const v4 = ingressAddresses.filter((a) => !a.includes(':')).sort();
  const v6 = ingressAddresses.filter((a) => a.includes(':')).sort();

  for (const host of [...new Set(ingressHosts)].filter((h) => !failoverHosts.has(h)).sort()) {
    const zone = zoneFor(host.replace(/^\*\./, ''), zones);

    if (!zone) {
      warnings.push(
        `${host} is in no managed zone; point it at ${ingressAddresses.join(', ') || 'the ingress'} yourself`,
      );
      continue;
    }

    const ttl = (zones.get(zone) as DnsZoneSpec).defaultTtl;

    if (v4.length) add({ zone, fqdn: host, type: 'A', values: v4, ttl, source: `ingress ${host}` });

    if (v6.length) add({ zone, fqdn: host, type: 'AAAA', values: v6, ttl, source: `ingress ${host}` });
  }

  return {
    records: [...records.values()].sort((a, b) => a.fqdn.localeCompare(b.fqdn) || a.type.localeCompare(b.type)),
    errors,
    warnings,
  };
}

export interface DnsChange {
  action: 'create' | 'update' | 'delete';
  zone: string;
  fqdn: string;
  type: DesiredRecordType;
  values: string[];
  previous?: string[];
}

/** The DNS effect of a plan (3.15): record sets created, changed or removed. */
export function diffDnsRecords(before: readonly DesiredRecord[], after: readonly DesiredRecord[]): DnsChange[] {
  const key = (r: DesiredRecord) => `${r.zone} ${r.fqdn} ${r.type}`;
  const old = new Map(before.map((r) => [key(r), r]));
  const changes: DnsChange[] = [];

  for (const r of after) {
    const previous = old.get(key(r));

    if (!previous) changes.push({ action: 'create', zone: r.zone, fqdn: r.fqdn, type: r.type, values: r.values });
    else if (previous.values.join() !== r.values.join() || previous.ttl !== r.ttl || previous.priority !== r.priority)
      changes.push({
        action: 'update',
        zone: r.zone,
        fqdn: r.fqdn,
        type: r.type,
        values: r.values,
        previous: previous.values,
      });

    old.delete(key(r));
  }

  for (const r of old.values())
    changes.push({ action: 'delete', zone: r.zone, fqdn: r.fqdn, type: r.type, values: [], previous: r.values });

  return changes;
}

/** The reverse-DNS name of an address: `10.113.0.203.in-addr.arpa`, or nibbles under `ip6.arpa`. */
export function reverseName(address: string): string {
  const ip = mustParseIp(address);

  if (ip.family === 4) return `${address.split('.').reverse().join('.')}.in-addr.arpa`;

  // From the parsed value, so every IPv6 notation (`::`, embedded IPv4) gives the same 32 nibbles.
  return `${ip.value.toString(16).padStart(32, '0').split('').reverse().join('.')}.ip6.arpa`;
}

/**
 * PTR records (3.27: reverse DNS through the DNS providers) in the managed reverse zone covering each address;
 * without one, the plan says where to set it instead.
 */
export function desiredPtrRecords(
  zones: ReadonlyMap<string, DnsZoneSpec>,
  ptrs: readonly { address: string; host: string; source: string }[],
): { records: DesiredRecord[]; warnings: string[] } {
  const records: DesiredRecord[] = [];
  const warnings: string[] = [];

  for (const ptr of ptrs) {
    const fqdn = reverseName(ptr.address);
    const zone = zoneFor(fqdn, zones);

    if (!zone) {
      warnings.push(
        `PTR ${ptr.address} → ${ptr.host}: no managed reverse zone covers it; set it where the address is delegated`,
      );
      continue;
    }

    records.push({
      zone,
      fqdn,
      type: 'PTR',
      values: [ptr.host],
      ttl: zones.get(zone)?.defaultTtl ?? 300,
      source: ptr.source,
    });
  }

  return { records, warnings };
}

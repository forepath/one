/** Record types every provider of the shared interface supports (3.15). */
export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV', 'CAA', 'NS', 'PTR'] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsZone {
  id: string;
  /** Zone apex without trailing dot, e.g. `example.com`. */
  name: string;
}

export interface DnsRecord {
  /** Provider id of the record; absent for records not created yet. */
  id?: string;
  /** Fully qualified name without trailing dot. */
  name: string;
  type: DnsRecordType;
  content: string;
  /** Seconds; providers clamp to their minimum (`capabilities.minTtl`). */
  ttl: number;
  /** MX / SRV priority. */
  priority?: number;
  /** Cloudflare-style proxying, only where `capabilities.proxied`. */
  proxied?: boolean;
}

/** What a provider can do; callers (plans, ACME, DNS failover) decide by these flags, never by provider id. */
export interface DnsProviderCapabilities {
  minTtl: number;
  wildcard: boolean;
  proxied: boolean;
  dnssec: boolean;
  createZones: boolean;
}

/**
 * One DNS provider account, behind the unified interface shared by Loadweaver, Agenstra and Decabill (3.15).
 * Instances are created per credential through a {@link DnsProviderFactory}.
 */
export interface DnsProvider {
  readonly id: string;
  readonly capabilities: DnsProviderCapabilities;
  listZones(): Promise<DnsZone[]>;
  createZone?(name: string): Promise<DnsZone>;
  listRecords(zoneId: string, filter?: { name?: string; type?: DnsRecordType }): Promise<DnsRecord[]>;
  /** Creates the record, or updates it in place when `record.id` is set. */
  upsertRecord(zoneId: string, record: DnsRecord): Promise<DnsRecord>;
  deleteRecord(zoneId: string, recordId: string): Promise<void>;
}

/** Creates a provider for one set of credentials (e.g. a Loadweaver secret or Decabill's env). */
export interface DnsProviderFactory<C = Record<string, string>> {
  readonly id: string;
  readonly displayName: string;
  create(config: C): DnsProvider;
}

import type { ConsoleResource } from './resources.types';

/** DNS (3.15, 3.28): zone sync state, DNSSEC, failovers and the declared records / zones / providers. */

/** `GET /dns/zones`: the last reconciliation of one zone at one provider. */
export interface DnsZoneStatus {
  zone: string;
  provider: string;
  syncedAt: string | null;
  error: string | null;
  /** Names that exist at the provider but aren't owned by Loadweaver (never changed or deleted). */
  conflicts: string[];
  /** Records changed in the last sync. */
  changes: number;
  /** Secondaries: how far behind the primary they are. */
  drift: string | null;
}

export interface DnssecKey {
  keyTag: number;
  state: 'active' | 'retired';
  createdAt: string;
  retiredAt: string | null;
  dsAtParent: boolean;
  dsCheckedAt: string | null;
  ds: string;
}

/** `GET /dns/dnssec`. */
export interface DnssecZone {
  zone: string;
  name: string;
  mode: 'signed' | 'insecure' | null;
  registrar: string | null;
  /** What the parent should publish now (by hand without a registrar). */
  expectedDs: string[];
  keys: DnssecKey[];
  nextRolloverAt: string | null;
}

export interface DnsEndpointHealth {
  healthy: boolean;
  /** Consecutive rounds: positive healthy, negative failed. */
  streak: number;
  since: string;
}

/** `GET /dns/failover`. */
export interface DnsFailoverState {
  name: string;
  state: {
    endpoints: Record<string, DnsEndpointHealth>;
    active: string[];
    latency?: Record<string, unknown>;
    failbackPending: boolean;
  };
  switchedAt: string | null;
  propagation: { done: boolean; lagging: string[]; checkedAt: string } | null;
  failbackConfirmed: boolean;
}

export interface DnsRecordSpec {
  /** `DnsZone` resource name. */
  zone: string;
  /** Relative to the zone; `@` is the apex. */
  name: string;
  type: string;
  values: string[];
  ttl?: number;
  priority?: number;
  [key: string]: unknown;
}

export interface DnsZoneSpec {
  zone: string;
  provider: string;
  secondaries?: string[];
  dnssec?: boolean;
  defaultTtl?: number;
  registrar?: { type: string };
  [key: string]: unknown;
}

export interface DnsProviderSpec {
  type: string;
  nodeGroup?: string;
  [key: string]: unknown;
}

export type DnsRecordResource = ConsoleResource<DnsRecordSpec>;
export type DnsZoneResource = ConsoleResource<DnsZoneSpec>;
export type DnsProviderResource = ConsoleResource<DnsProviderSpec>;

/**
 * Everything the DNS view shows. Parts the caller may not read (cluster-only endpoints for project members) or that
 * failed stay `null`.
 */
export interface DnsOverview {
  zones: DnsZoneStatus[] | null;
  dnssec: DnssecZone[] | null;
  failovers: DnsFailoverState[] | null;
  records: DnsRecordResource[] | null;
  zoneResources: DnsZoneResource[] | null;
  providers: DnsProviderResource[] | null;
}

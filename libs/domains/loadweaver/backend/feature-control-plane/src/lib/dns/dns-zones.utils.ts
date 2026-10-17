import type { DnsProviderSpec, DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';

import type { DesiredRecord } from './dns-desired.utils';
import { steeringViews, type SteeredHost } from './steering.utils';

/** How a zone's providers get its records (3.15). */
export type ZoneRole = 'api' | 'bind9' | 'axfr';

export function providerRole(spec: DnsProviderSpec): ZoneRole {
  return spec.type === 'bind9' ? 'bind9' : spec.type === 'axfr' ? 'axfr' : 'api';
}

/**
 * Combinations of primary and secondaries that work: the cluster's records reach API providers and hosted bind9
 * directly; AXFR secondaries pull from hosted bind9; an external AXFR primary owns the zone, hosted bind9 pulls from
 * it and the cluster can't add records there. DNSSEC is signed by hosted bind9, so it needs bind9 as primary and only
 * secondaries that receive the signed zone (bind9, AXFR).
 */
export function zoneSetupIssues(
  zones: ReadonlyMap<string, DnsZoneSpec>,
  providers: ReadonlyMap<string, DnsProviderSpec>,
  records: readonly DesiredRecord[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [name, zone] of zones) {
    const primary = providers.get(zone.provider);
    const secondaries = zone.secondaries.map((s) => [s, providers.get(s)] as const);
    const missing = [zone.provider, ...zone.secondaries].filter((p) => !providers.has(p));

    if (missing.length > 0) {
      errors.push(`zone ${zone.zone}: provider ${missing.join(', ')} does not exist`);
      continue;
    }

    const role = providerRole(primary as DnsProviderSpec);
    const roles = secondaries.map(([s, spec]) => [s, providerRole(spec as DnsProviderSpec)] as const);

    if (role === 'axfr') {
      const notBind9 = roles.filter(([, r]) => r !== 'bind9').map(([s]) => s);

      if (notBind9.length > 0)
        errors.push(
          `zone ${zone.zone}: with an external primary, only hosted bind9 can be secondary (not ${notBind9.join(', ')})`,
        );

      if (roles.length === 0) errors.push(`zone ${zone.zone}: an external primary needs a hosted bind9 secondary`);

      const inZone = records.filter((r) => r.zone === name).map((r) => `${r.type} ${r.fqdn} (${r.source})`);

      if (inZone.length > 0)
        errors.push(
          `zone ${zone.zone} belongs to an external primary; add these records there instead: ${inZone.join(', ')}`,
        );
    } else {
      const axfr = roles.filter(([, r]) => r === 'axfr').map(([s]) => s);

      if (axfr.length > 0 && role !== 'bind9')
        errors.push(`zone ${zone.zone}: AXFR secondaries (${axfr.join(', ')}) pull from hosted bind9 as primary`);
    }

    if (zone.dnssec) {
      if (role !== 'bind9') errors.push(`zone ${zone.zone}: DNSSEC is signed by hosted bind9, which must be primary`);

      const api = roles.filter(([, r]) => r === 'api').map(([s]) => s);

      if (api.length > 0)
        errors.push(
          `zone ${zone.zone}: ${api.join(', ')} would serve the records unsigned; with DNSSEC, secondaries get the signed zone by AXFR`,
        );

      if (!zone.registrar)
        warnings.push(
          `zone ${zone.zone}: DNSSEC without a registrar; publish the DS records shown by GET /dns/dnssec at the parent by hand`,
        );
    } else if (zone.registrar) {
      warnings.push(`zone ${zone.zone}: a registrar only publishes DS records for DNSSEC zones`);
    }
  }

  return { errors, warnings };
}

/**
 * Steering (3.28) needs hosted bind9 views: hosts in zones with AXFR secondaries can't be steered (a transfer has
 * one variant), API providers only serve the default answer, and the views must stay within bind9's limit.
 */
export function steeringIssues(
  steered: readonly SteeredHost[],
  zones: ReadonlyMap<string, DnsZoneSpec>,
  providers: ReadonlyMap<string, DnsProviderSpec>,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byProvider = new Map<string, SteeredHost[]>();

  for (const host of steered) {
    const zone = zones.get(host.zone);

    if (!zone) continue;

    const chain = [zone.provider, ...zone.secondaries].map((p) => [p, providers.get(p)] as const);
    const axfr = chain.filter(([, p]) => p?.type === 'axfr').map(([n]) => n);
    const api = chain.filter(([, p]) => p && providerRole(p) === 'api').map(([n]) => n);
    const bind9 = chain.filter(([, p]) => p?.type === 'bind9').map(([n]) => n);

    if (axfr.length > 0)
      errors.push(`${host.fqdn}: steered answers can't be transferred to the AXFR secondaries of zone ${zone.zone}`);

    if (bind9.length === 0)
      warnings.push(`${host.fqdn}: steering needs hosted bind9; ${api.join(', ')} answers everyone the same`);
    else if (api.length > 0)
      warnings.push(`${host.fqdn}: only hosted bind9 steers; ${api.join(', ')} answers everyone the default`);

    for (const p of bind9) byProvider.set(p, [...(byProvider.get(p) ?? []), host]);
  }

  for (const [provider, hosts] of byProvider) {
    const views = steeringViews(hosts, true);

    if ('error' in views) errors.push(`${provider}: ${views.error}`);
  }

  return { errors, warnings };
}

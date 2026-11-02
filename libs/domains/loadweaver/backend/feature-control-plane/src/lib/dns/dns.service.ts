import {
  dnsProviderSpecSchema,
  dnsRecordSpecSchema,
  dnsZoneSpecSchema,
  policySpecSchema,
  type DnsProviderSpec,
  type DnsZoneSpec,
} from '@forepath/loadweaver/shared/util-model';
import { Injectable } from '@nestjs/common';

import type { ResourceEntity } from '../entities/resource.entity';
import { collectExposures, statusPageHosts } from '../ingress/ingress-state.utils';
import { WorkloadPlannerService } from '../services/workload-planner.service';
import { egressPolicyOf } from '../ipam/public-ipam.utils';
import {
  desiredDnsRecords,
  desiredPtrRecords,
  diffDnsRecords,
  zoneFor,
  type DnsChange,
  type DnsDesiredState,
} from './dns-desired.utils';
import { dnsFailovers, failoverAnswers, type FailoverState } from './dns-failover.utils';
import { steeringIssues, zoneSetupIssues } from './dns-zones.utils';

export function dnsZones(
  resources: readonly Pick<ResourceEntity, 'kind' | 'name' | 'spec'>[],
): Map<string, DnsZoneSpec> {
  return new Map(resources.filter((r) => r.kind === 'DnsZone').map((r) => [r.name, dnsZoneSpecSchema.parse(r.spec)]));
}

export function dnsProviders(
  resources: readonly Pick<ResourceEntity, 'kind' | 'name' | 'spec'>[],
): Map<string, DnsProviderSpec> {
  return new Map(
    resources.filter((r) => r.kind === 'DnsProvider').map((r) => [r.name, dnsProviderSpecSchema.parse(r.spec)]),
  );
}

/** Desired DNS (3.15) from resources and the ingress addresses, for plans and the reconciler. */
@Injectable()
export class DnsService {
  constructor(private readonly planner: WorkloadPlannerService) {}

  desired(
    resources: readonly ResourceEntity[],
    addressRows: readonly { address: string; owner: string | null; state: string }[],
    failoverStates: ReadonlyMap<string, FailoverState> = new Map(),
  ): DnsDesiredState {
    const assigned = addressRows.filter((r) => r.state === 'assigned');
    const ingressAddresses = assigned.filter((r) => r.owner?.startsWith('ingress/')).map((r) => r.address);
    // Reverse DNS for egress addresses (3.27).
    const reverseDns = new Map(
      resources
        .filter((r) => r.kind === 'Policy')
        .flatMap((r) => {
          const host = policySpecSchema.parse(r.spec).egress?.reverseDns;

          return host ? [[r.project ? `${r.project}/${r.name}` : r.name, host] as const] : [];
        }),
    );
    const ptrs = assigned.flatMap((r) => {
      const policy = egressPolicyOf(r.owner);
      const host = policy ? reverseDns.get(policy) : undefined;

      return host ? [{ address: r.address, host, source: `Policy ${policy}` }] : [];
    });
    const declared = resources
      .filter((r) => r.kind === 'DnsRecord')
      .map((r) => ({ name: r.name, project: r.project ?? undefined, spec: dnsRecordSpecSchema.parse(r.spec) }));
    const hosts = collectExposures(this.planner.parse(resources).parsed, statusPageHosts(resources)).sites.map(
      (s) => s.host,
    );

    const zones = dnsZones(resources);
    const providers = dnsProviders(resources);
    const answers = failoverAnswers(dnsFailovers(resources), failoverStates);
    const records = desiredDnsRecords(zones, declared, hosts, ingressAddresses, answers);
    const ptr = desiredPtrRecords(zones, ptrs);
    const desired = {
      ...records,
      records: [...records.records, ...ptr.records],
      warnings: [...records.warnings, ...ptr.warnings],
    };
    const steered = answers.flatMap((a) => {
      const zone = zoneFor(a.host, zones);

      return a.steering && zone ? [{ zone, fqdn: a.host, addresses: a.addresses, steering: a.steering }] : [];
    });
    const setup = zoneSetupIssues(zones, providers, desired.records);
    const steering = steeringIssues(steered, zones, providers);

    return {
      ...desired,
      errors: [...desired.errors, ...setup.errors, ...steering.errors],
      warnings: [...desired.warnings, ...setup.warnings, ...steering.warnings],
      steered,
    };
  }

  /** Plan effect in words: "creates A www.example.com → 203.0.113.10 at cf (zone example)". */
  describe(
    changes: readonly DnsChange[],
    resources: readonly ResourceEntity[],
  ): { layer: string; action: string; node: string; summary: string }[] {
    const zones = dnsZones(resources);

    return changes.map((c) => {
      const zone = zones.get(c.zone);
      const where = zone ? `at ${[zone.provider, ...zone.secondaries].join(', ')} (zone ${zone.zone})` : '';
      const verb = c.action === 'create' ? 'creates' : c.action === 'update' ? 'changes' : 'removes';
      const values =
        c.action === 'delete'
          ? (c.previous ?? []).join(', ')
          : `${c.values.join(', ')}${c.previous ? ` (was ${c.previous.join(', ')})` : ''}`;

      return {
        layer: 'dns-records',
        action: c.action,
        node: c.zone,
        summary: `${verb} ${c.type} ${c.fqdn} → ${values} ${where}`.trim(),
      };
    });
  }

  diff(before: DnsDesiredState, after: DnsDesiredState): DnsChange[] {
    return diffDnsRecords(before.records, after.records);
  }
}

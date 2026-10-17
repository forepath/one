import { canRunWorkloads, eligibleNodes } from './schedule';
import type {
  FailureAnalysis,
  FailureScope,
  Resources,
  ScheduleResult,
  SchedulerNode,
  SchedulerService,
  SinglePointOfFailure,
} from './types';

function lost(scope: FailureScope, node: SchedulerNode): boolean {
  return scope.kind === 'node' ? node.name === scope.name : node.site === scope.name;
}

/**
 * Failure analysis (3.12): simulates the loss of every single node (and every site when the failure domain is
 * `site`) and checks that data, deployments and capacity survive. Every single point of failure is listed with
 * its cause, e.g. "volume db-data has no replica outside n2".
 */
export function analyzeFailures(
  nodes: readonly SchedulerNode[],
  services: readonly SchedulerService[],
  result: ScheduleResult,
  failureDomain: 'node' | 'site' = 'node',
): FailureAnalysis {
  const findings: SinglePointOfFailure[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.name, n]));
  const scopes: FailureScope[] = nodes.filter((n) => !n.witness).map((n) => ({ kind: 'node' as const, name: n.name }));

  if (failureDomain === 'site')
    scopes.push(...[...new Set(nodes.map((n) => n.site))].map((s) => ({ kind: 'site' as const, name: s })));

  let nPlusOne = true;

  for (const scope of scopes) {
    const survivors = nodes.filter((n) => !lost(scope, n));
    const label = scope.kind === 'node' ? scope.name : `site ${scope.name}`;

    // Data: a volume survives if a copy exists outside the lost scope.
    for (const volume of result.volumes) {
      const copies = [volume.primary, ...volume.syncReplicas, ...volume.remoteReplicas];

      if (
        copies.every((c) => {
          const n = nodeMap.get(c);
          return !n || lost(scope, n);
        })
      ) {
        findings.push({
          scope,
          kind: 'data',
          subject: `volume ${volume.volume}`,
          reason: `volume ${volume.volume} has no replica outside ${label}`,
        });
      }
    }

    // Deployments: replicas outside the scope keep serving, or the service can be rescheduled.
    for (const service of services) {
      const placed = result.replicas.filter((r) => r.service === service.id);

      if (placed.length === 0) continue;

      const remaining = placed.filter((r) => {
        const n = nodeMap.get(r.node);
        return n && !lost(scope, n);
      });

      if (remaining.length > 0) continue;

      const elsewhere = eligibleNodes(service, survivors);
      const volumeLost = service.volumes.some((v) =>
        findings.some((f) => f.kind === 'data' && f.subject === `volume ${v.id}` && f.scope === scope),
      );
      // A stateful service can only restart where a copy of every one of its volumes lives (failover, 3.10).
      const withData = elsewhere.filter((n) =>
        service.volumes.every((v) => {
          const placement = result.volumes.find((p) => p.volume === v.id);

          return (
            !!placement && [placement.primary, ...placement.syncReplicas, ...placement.remoteReplicas].includes(n.name)
          );
        }),
      );

      if (elsewhere.length === 0)
        findings.push({
          scope,
          kind: 'deployment',
          subject: service.id,
          reason: `${service.id} has no other eligible node than ${label}`,
        });
      else if (volumeLost)
        findings.push({
          scope,
          kind: 'deployment',
          subject: service.id,
          reason: `${service.id} loses its data with ${label}`,
        });
      else if (withData.length === 0)
        findings.push({
          scope,
          kind: 'deployment',
          subject: service.id,
          reason: `no eligible node outside ${label} holds a replica of the volumes of ${service.id}`,
        });
    }

    // Capacity (N+1): what ran in the lost scope must fit into the free capacity of the survivors.
    const displaced = result.replicas.filter((r) => {
      const n = nodeMap.get(r.node);
      return n && lost(scope, n);
    });

    if (displaced.length === 0) continue;

    const free = new Map<string, Resources>(
      survivors.filter(canRunWorkloads).map((n) => {
        const used = result.allocated[n.name] ?? { cpuMillis: 0, memoryBytes: 0 };

        return [
          n.name,
          { cpuMillis: n.capacity.cpuMillis - used.cpuMillis, memoryBytes: n.capacity.memoryBytes - used.memoryBytes },
        ];
      }),
    );
    const serviceById = new Map(services.map((s) => [s.id, s]));
    // Largest first, first fit: a simple, conservative packing.
    const sorted = [...displaced].sort(
      (a, b) =>
        (serviceById.get(b.service)?.requests.memoryBytes ?? 0) -
        (serviceById.get(a.service)?.requests.memoryBytes ?? 0),
    );

    for (const replica of sorted) {
      const service = serviceById.get(replica.service);

      if (!service) continue;

      const target = eligibleNodes(service, survivors).find((n) => {
        const f = free.get(n.name);

        return !!f && f.cpuMillis >= service.requests.cpuMillis && f.memoryBytes >= service.requests.memoryBytes;
      });

      if (!target) {
        if (scope.kind === 'node') nPlusOne = false;

        findings.push({
          scope,
          kind: 'capacity',
          subject: replica.replica,
          reason: `not enough capacity to restart ${replica.replica} after losing ${label}`,
        });
        continue;
      }

      const f = free.get(target.name) as Resources;

      free.set(target.name, {
        cpuMillis: f.cpuMillis - service.requests.cpuMillis,
        memoryBytes: f.memoryBytes - service.requests.memoryBytes,
      });
    }
  }

  return { findings, nPlusOne };
}

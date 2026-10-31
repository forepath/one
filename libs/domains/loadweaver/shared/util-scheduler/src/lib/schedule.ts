import {
  canHoldBlockVolumes,
  canHoldVolumes,
  eligibleNodes,
  hasRequiredFeatures,
  ineligibilityReason,
  missingFeaturesReason,
} from './eligibility';
import type {
  HeldVolumeCopy,
  ReplicaPlacement,
  Resources,
  ScheduleInput,
  ScheduleResult,
  SchedulerNode,
  SchedulerVolume,
  Unschedulable,
  VolumePlacement,
} from './types';

const ZERO: Resources = { cpuMillis: 0, memoryBytes: 0 };

function add(a: Resources, b: Resources): Resources {
  return { cpuMillis: a.cpuMillis + b.cpuMillis, memoryBytes: a.memoryBytes + b.memoryBytes };
}

function fits(capacity: Resources, used: Resources, request: Resources): boolean {
  return (
    used.cpuMillis + request.cpuMillis <= capacity.cpuMillis &&
    used.memoryBytes + request.memoryBytes <= capacity.memoryBytes
  );
}

/** Load as the larger of CPU and memory utilisation, for balancing. */
function load(capacity: Resources, used: Resources): number {
  return Math.max(
    capacity.cpuMillis ? used.cpuMillis / capacity.cpuMillis : 1,
    capacity.memoryBytes ? used.memoryBytes / capacity.memoryBytes : 1,
  );
}

/** Nodes that can hold copies of this volume: DRBD 9, and block-volume support for VM disks (3.5, 3.35). */
function canHold(volume: SchedulerVolume, node: SchedulerNode): boolean {
  return volume.mode === 'block' ? canHoldBlockVolumes(node) : canHoldVolumes(node);
}

class Ledger {
  readonly allocated = new Map<string, Resources>();
  readonly disk = new Map<string, number>();

  constructor(private readonly nodes: Map<string, SchedulerNode>) {}

  used(node: string): Resources {
    return this.allocated.get(node) ?? ZERO;
  }

  canPlace(node: SchedulerNode, request: Resources, diskBytes = 0): boolean {
    return (
      fits(node.capacity, this.used(node.name), request) &&
      (this.disk.get(node.name) ?? 0) + diskBytes <= node.diskBytes
    );
  }

  place(node: string, request: Resources): void {
    this.allocated.set(node, add(this.used(node), request));
  }

  reserveDisk(node: string, bytes: number): void {
    this.disk.set(node, (this.disk.get(node) ?? 0) + bytes);
  }

  load(node: string): number {
    const n = this.nodes.get(node);

    return n ? load(n.capacity, this.used(node)) : 1;
  }
}

function placeVolume(
  volume: SchedulerVolume,
  primary: SchedulerNode,
  nodes: SchedulerNode[],
  ledger: Ledger,
  current: VolumePlacement | undefined,
  held: HeldVolumeCopy[],
): VolumePlacement {
  const previous = current ? [current.primary, ...current.syncReplicas, ...current.remoteReplicas] : [];
  // Draining and leaving nodes receive no new copies; their copies move elsewhere (3.12).
  const possible = nodes.filter(
    (n) =>
      n.reachable &&
      !n.witness &&
      n.lifecycle !== 'leaving' &&
      n.lifecycle !== 'draining' &&
      n.name !== primary.name &&
      canHold(volume, n),
  );
  // Nodes that aren't ready (joining) keep their copies but get no new ones: a copy there would hold the apply up
  // until the node finished initialising, and the plan would roll back (M6 gate).
  const storageNodes = possible.filter((n) => !n.notReady || previous.includes(n.name));
  const heldBack = possible.filter((n) => n.notReady && !previous.includes(n.name));
  const pick = (candidates: SchedulerNode[], count: number, preferred: string[]): string[] => {
    const ordered = [...candidates].sort(
      (a, b) =>
        Number(preferred.includes(b.name)) - Number(preferred.includes(a.name)) ||
        (ledger.disk.get(a.name) ?? 0) - (ledger.disk.get(b.name) ?? 0) ||
        a.name.localeCompare(b.name),
    );
    const chosen: string[] = [];

    for (const node of ordered) {
      if (chosen.length >= count) break;

      if ((ledger.disk.get(node.name) ?? 0) + volume.sizeBytes > node.diskBytes) continue;

      chosen.push(node.name);
      ledger.reserveDisk(node.name, volume.sizeBytes);
    }

    return chosen;
  };
  const syncReplicas = pick(
    storageNodes.filter((n) => n.site === primary.site),
    Math.max(0, volume.replicas - 1),
    previous,
  );
  const remoteReplicas =
    volume.crossSite === 'none'
      ? []
      : pick(
          storageNodes.filter((n) => n.site !== primary.site),
          1,
          previous,
        );
  const wantedSync = Math.max(0, volume.replicas - 1);
  const missingSync = syncReplicas.length < wantedSync;
  const missingRemote = volume.crossSite !== 'none' && remoteReplicas.length === 0;
  const relevant = heldBack.filter(
    (n) => (missingSync && n.site === primary.site) || (missingRemote && n.site !== primary.site),
  );

  if (relevant.length > 0)
    held.push({
      volume: volume.id,
      kind: 'replica',
      nodes: relevant.map((n) => ({ name: n.name, reason: n.notReady as string })),
    });

  return { volume: volume.id, primary: primary.name, syncReplicas, remoteReplicas };
}

/**
 * Places replicas and volume replicas (3.11, 3.5). Deterministic and stable: existing placements are kept while
 * still valid, so a plan only moves what has to move. Requests drive capacity; nothing is overcommitted.
 */
export function schedule(input: ScheduleInput): ScheduleResult {
  const nodeMap = new Map(input.nodes.map((n) => [n.name, n]));
  const ledger = new Ledger(nodeMap);
  const replicas: ReplicaPlacement[] = [];
  const volumes: VolumePlacement[] = [];
  const unschedulable: Unschedulable[] = [];
  const held: HeldVolumeCopy[] = [];
  const currentReplicas = new Map((input.current?.replicas ?? []).map((r) => [r.replica, r.node]));
  const currentVolumes = new Map((input.current?.volumes ?? []).map((v) => [v.volume, v]));
  // Stateful services first: their volumes constrain where they can go.
  const ordered = [...input.services].sort(
    (a, b) => Number(b.volumes.length > 0) - Number(a.volumes.length > 0) || a.id.localeCompare(b.id),
  );

  for (const service of ordered) {
    const candidates = eligibleNodes(service, input.nodes);

    if (candidates.length === 0) {
      unschedulable.push({
        service: service.id,
        reason: ineligibilityReason(service, input.nodes) ?? 'no eligible node',
      });
      continue;
    }

    if (service.volumes.length > 0) {
      const diskNeeded = service.volumes.reduce((sum, v) => sum + v.sizeBytes, 0);
      const replicaId = `${service.id}/0`;
      const existing = service.volumes.map((v) => currentVolumes.get(v.id)).filter((v): v is VolumePlacement => !!v);
      // Data locality: once a volume exists, the service can only run where a copy of every volume lives
      // (failover and migration promote a replica, 3.10). New volumes may go anywhere.
      const holders =
        existing.length > 0 ? existing.map((v) => new Set([v.primary, ...v.syncReplicas, ...v.remoteReplicas])) : null;
      const withDrbd = candidates.filter((n) => service.volumes.every((v) => canHold(v, n)));

      if (withDrbd.length === 0) {
        const block = service.volumes.some((v) => v.mode === 'block') && candidates.some(canHoldVolumes);

        unschedulable.push({
          service: service.id,
          replica: replicaId,
          reason: block
            ? 'no eligible node can hold the block volumes its VM disks need (DRBD 9 and an agent with the protocol feature vm-block-volumes)'
            : 'no eligible node has the DRBD 9 kernel module its volumes need (node capability drbd9; install the Loadweaver release bundle)',
        });
        continue;
      }

      const located = holders ? withDrbd.filter((n) => holders.every((h) => h.has(n.name))) : withDrbd;
      // Agent features (M6 gate): a new placement needs them; the replica's current node stays allowed.
      const allowed = located.filter(
        (n) => hasRequiredFeatures(service, n) || n.name === currentReplicas.get(replicaId),
      );
      const preferred = [
        ...existing.map((v) => v.primary),
        currentReplicas.get(replicaId),
        ...existing.flatMap((v) => v.syncReplicas),
        ...existing.flatMap((v) => v.remoteReplicas),
      ].filter((n): n is string => !!n);
      const fitting = allowed.filter((n) => ledger.canPlace(n, service.requests, holders ? 0 : diskNeeded));
      // New volumes: their primary on a ready node when one fits (a not-ready node only as the last resort, noted).
      const readyFitting = holders ? fitting : fitting.filter((n) => !n.notReady);
      const candidatesForPrimary = readyFitting.length > 0 ? readyFitting : fitting;
      const node =
        preferred.map((p) => candidatesForPrimary.find((n) => n.name === p)).find((n): n is SchedulerNode => !!n) ??
        [...candidatesForPrimary].sort(
          (a, b) => ledger.load(a.name) - ledger.load(b.name) || a.name.localeCompare(b.name),
        )[0];

      if (node?.notReady && !holders)
        service.volumes.forEach((v) =>
          held.push({ volume: v.id, kind: 'primary', nodes: [{ name: node.name, reason: node.notReady as string }] }),
        );

      if (!node && allowed.length < located.length && located.some((n) => ledger.canPlace(n, service.requests, 0))) {
        unschedulable.push({ service: service.id, replica: replicaId, reason: missingFeaturesReason(service) });
        continue;
      }

      if (!node && holders) {
        unschedulable.push({
          service: service.id,
          replica: replicaId,
          reason: 'no eligible node holding a copy of its volumes has enough capacity',
        });
        continue;
      }

      if (!node) {
        unschedulable.push({
          service: service.id,
          replica: replicaId,
          reason: 'no eligible node with enough capacity and disk',
        });
        continue;
      }

      ledger.place(node.name, service.requests);
      service.volumes.forEach((v) => {
        ledger.reserveDisk(node.name, v.sizeBytes);
        volumes.push(placeVolume(v, node, input.nodes, ledger, currentVolumes.get(v.id), held));
      });
      replicas.push({ service: service.id, replica: replicaId, node: node.name });

      for (let i = 1; i < service.replicas; i++) {
        // DRBD volumes have one writer: a stateful service runs one replica, protected by volume replicas.
        unschedulable.push({
          service: service.id,
          replica: `${service.id}/${i}`,
          reason: 'services with read-write volumes run a single replica',
        });
      }

      continue;
    }

    const perNode = new Map<string, number>();
    const perSite = new Map<string, number>();
    const assigned = new Map<number, SchedulerNode>();
    const record = (index: number, node: SchedulerNode) => {
      ledger.place(node.name, service.requests);
      perNode.set(node.name, (perNode.get(node.name) ?? 0) + 1);
      perSite.set(node.site, (perSite.get(node.site) ?? 0) + 1);
      assigned.set(index, node);
    };

    // Pass 1: keep every replica whose node is still valid, so nothing moves without a reason.
    for (let i = 0; i < service.replicas; i++) {
      const keep = currentReplicas.get(`${service.id}/${i}`);
      const kept = keep ? candidates.find((n) => n.name === keep) : undefined;

      if (kept && (perNode.get(kept.name) ?? 0) === 0 && ledger.canPlace(kept, service.requests)) record(i, kept);
    }

    // Pass 2: place the rest, spreading over nodes (and sites), then balancing load. New replicas only go to nodes
    // whose agent has the features the service needs (M6 gate); pass 1 kept replicas already elsewhere.
    const capable = candidates.filter((n) => hasRequiredFeatures(service, n));
    const sites = [...new Set(capable.map((c) => c.site))];

    for (let i = 0; i < service.replicas; i++) {
      if (assigned.has(i)) continue;

      const minSite = Math.min(...sites.map((site) => perSite.get(site) ?? 0));
      const node = [...capable]
        .filter((n) => ledger.canPlace(n, service.requests))
        .sort(
          (a, b) =>
            (perNode.get(a.name) ?? 0) - (perNode.get(b.name) ?? 0) ||
            (service.spread === 'site'
              ? Number((perSite.get(a.site) ?? 0) > minSite) - Number((perSite.get(b.site) ?? 0) > minSite)
              : 0) ||
            (perSite.get(a.site) ?? 0) - (perSite.get(b.site) ?? 0) ||
            ledger.load(a.name) - ledger.load(b.name) ||
            a.name.localeCompare(b.name),
        )[0];

      if (!node) {
        const featureBound =
          capable.length < candidates.length &&
          candidates.some((n) => !hasRequiredFeatures(service, n) && ledger.canPlace(n, service.requests));

        unschedulable.push({
          service: service.id,
          replica: `${service.id}/${i}`,
          reason: featureBound ? missingFeaturesReason(service) : 'not enough free capacity on eligible nodes',
        });
        continue;
      }

      record(i, node);
    }

    [...assigned.entries()]
      .sort(([a], [b]) => a - b)
      .forEach(([i, node]) => replicas.push({ service: service.id, replica: `${service.id}/${i}`, node: node.name }));
  }

  return {
    replicas,
    volumes,
    unschedulable,
    allocated: Object.fromEntries(ledger.allocated),
    ...(held.length > 0 ? { held } : {}),
  };
}

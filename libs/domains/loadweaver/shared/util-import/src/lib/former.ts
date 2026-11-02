import type { DiscoveryReport } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { FormerClassification, FormerReplica, ImportClusterContext } from './types';

/**
 * A former Loadweaver installation found by discovery (3.21):
 * - same cluster (cluster id matches): replicas the cluster still assigns to this node (same DRBD minor, the node
 *   still a holder, backing device present and large enough, its host in the resource) are reused — DRBD resyncs only
 *   the difference; everything else is removed by the volume manager when the node is activated;
 * - different or unknown cluster: nothing is reused, the old identity and keys are discarded (explicit in the plan),
 *   and its plain Docker workloads go through the import wizard like any host's.
 */
export function classifyFormer(report: DiscoveryReport, cluster: ImportClusterContext): FormerClassification | null {
  const former = report.former;

  if (!former) return null;

  const sameCluster = !!former.clusterId && former.clusterId === cluster.clusterId;
  const reusable: FormerReplica[] = [];
  const discarded: FormerReplica[] = [];
  const byMinor = new Map(cluster.volumes.map((v) => [v.drbdMinor, v]));

  for (const resource of former.drbdResources) {
    const base = { resource: resource.name, minor: resource.minor };

    if (!sameCluster) {
      discarded.push({ ...base, reason: 'belongs to another cluster' });
      continue;
    }

    const volume = byMinor.get(resource.minor);

    if (!volume) {
      discarded.push({ ...base, reason: 'no volume of this cluster uses this DRBD minor any more' });
      continue;
    }

    const withVolume = { ...base, volume: volume.id };

    if (former.nodeName && former.nodeName !== cluster.node) {
      discarded.push({ ...withVolume, reason: `the node rejoins as ${cluster.node}, not as ${former.nodeName}` });
    } else if (!volume.holders.includes(cluster.node)) {
      discarded.push({ ...withVolume, reason: 'the volume no longer has a copy on this node' });
    } else if (!resource.backingDevice) {
      discarded.push({ ...withVolume, reason: 'the backing device is gone' });
    } else if (resource.sizeBytes !== undefined && resource.sizeBytes < volume.sizeBytes) {
      discarded.push({ ...withVolume, reason: 'the backing device is smaller than the volume' });
    } else if (resource.hosts.length > 0 && !resource.hosts.some((h) => h.host === report.hostname)) {
      discarded.push({ ...withVolume, reason: `the resource does not name this host (${report.hostname})` });
    } else {
      reusable.push({ ...withVolume, reason: 'still assigned to this node: only the difference is resynced' });
    }
  }

  return {
    kind: sameCluster ? 'same-cluster' : former.clusterId ? 'other-cluster' : 'unknown-cluster',
    ...(former.clusterId ? { clusterId: former.clusterId } : {}),
    ...(former.nodeName ? { nodeName: former.nodeName } : {}),
    reusable,
    discarded,
    requiresWipe: !sameCluster,
  };
}

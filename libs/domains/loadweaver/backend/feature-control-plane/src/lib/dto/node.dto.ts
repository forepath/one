import { RUNTIMES, isRuntime, type Runtime } from '@forepath/loadweaver/shared/util-model';
import { runtimeNodeLabels } from '@forepath/loadweaver/shared/util-scheduler';

import type { NodeEntity, NodeLifecycle } from '../entities/node.entity';

/** Ready isolation levels a node reports (3.1), in ladder order; unknown names are dropped, `runc` without a report. */
export function nodeRuntimes(capabilities: Record<string, unknown> | null | undefined): Runtime[] {
  const reported = capabilities?.['runtimes'];
  const levels = Array.isArray(reported) ? reported.filter(isRuntime) : ['runc' as const];

  return RUNTIMES.filter((r) => levels.includes(r));
}

/** The labels node selectors match (3.1): own labels, site / node and the derived runtime labels (these win). */
export function effectiveNodeLabels(
  node: Pick<NodeEntity, 'name' | 'site' | 'labels' | 'capabilities'>,
): Record<string, string> {
  return {
    ...(node.labels ?? {}),
    ...runtimeNodeLabels(nodeRuntimes(node.capabilities)),
    'loadweaver.com/site': node.site,
    'loadweaver.com/node': node.name,
  };
}

export interface NodeResponseDto {
  name: string;
  site: string;
  lifecycle: NodeLifecycle;
  labels: Record<string, string>;
  /**
   * Labels selectors see (3.1): the node's labels, `loadweaver.com/site` / `node` and the derived runtime labels
   * (`runtime.loadweaver.com/<level>: ready`, `loadweaver.com/runtime: <strongest ready level>`).
   */
  effectiveLabels: Record<string, string>;
  /** Ready isolation levels (3.1, ladder order); a workload runs only on nodes with exactly its level. */
  runtimes: string[];
  controlPlane: boolean;
  witness: boolean;
  agentVersion: string | null;
  os: NodeEntity['os'];
  capabilities: Record<string, unknown> | null;
  capacity: NodeEntity['capacity'];
  usage: NodeEntity['usage'];
  endpointHost: string | null;
  overlayV4: string | null;
  overlayV6: string | null;
  podSubnetV4: string | null;
  podSubnetV6: string | null;
  appliedRevision: number;
  applyStatus: NodeEntity['applyStatus'];
  applyError: string | null;
  certificateNotAfter: string | null;
  lastSeenAt: string | null;
  connected: boolean;
  joinedAt: string;
}

export function toNodeResponse(node: NodeEntity, connected: boolean): NodeResponseDto {
  return {
    name: node.name,
    site: node.site,
    lifecycle: node.lifecycle,
    labels: node.labels,
    effectiveLabels: effectiveNodeLabels(node),
    runtimes: nodeRuntimes(node.capabilities),
    controlPlane: node.controlPlane,
    witness: node.witness,
    agentVersion: node.agentVersion,
    os: node.os,
    capabilities: node.capabilities,
    capacity: node.capacity,
    usage: node.usage,
    endpointHost: node.endpointHost,
    overlayV4: node.overlayV4,
    overlayV6: node.overlayV6,
    podSubnetV4: node.podSubnetV4,
    podSubnetV6: node.podSubnetV6,
    appliedRevision: node.appliedRevision,
    applyStatus: node.applyStatus,
    applyError: node.applyError,
    certificateNotAfter: node.certificateNotAfter?.toISOString() ?? null,
    lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
    connected,
    joinedAt: node.joinedAt.toISOString(),
  };
}

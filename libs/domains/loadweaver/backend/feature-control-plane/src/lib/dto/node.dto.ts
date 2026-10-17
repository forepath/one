import type { NodeEntity, NodeLifecycle } from '../entities/node.entity';

export interface NodeResponseDto {
  name: string;
  site: string;
  lifecycle: NodeLifecycle;
  labels: Record<string, string>;
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

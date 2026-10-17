import type { ObjectStoreRole, RegistryClient, RegistryRole } from '@forepath/loadweaver/shared/util-agent-protocol';
import { PRIVATE_REGISTRY_HOST, type ClusterRegistry } from '@forepath/loadweaver/shared/util-model';

import type { NodeEntity } from '../entities/node.entity';
import type { ObjectStoreGenerationEntity } from '../entities/object-store-generation.entity';
import { objectStorePorts, REGISTRY_BUCKET } from './object-store.utils';

export const REGISTRY_PRIVATE_PORT = 5000;
/** Loopback port of the agent's pull router on every node (3.22). */
export const REGISTRY_ROUTER_PORT = 7479;
export const REGISTRY_TOKEN_ISSUER = 'loadweaver-control-plane';
export const REGISTRY_TOKEN_SERVICE = 'loadweaver-registry';

type Generation = Pick<ObjectStoreGenerationEntity, 'generation' | 'replicationFactor' | 'state' | 'holders' | 'copy'>;
type Node = Pick<NodeEntity, 'name' | 'site' | 'overlayV4' | 'overlayV6'>;

function overlay(node: Node): string | null {
  return node.overlayV4 ?? node.overlayV6 ?? null;
}

export function mirrorPort(index: number): number {
  return REGISTRY_PRIVATE_PORT + 1 + index;
}

/** Garage generations the node runs; secrets are added at push time. */
export function objectStoreRole(node: Node, generations: readonly Generation[]): ObjectStoreRole | undefined {
  const mine = generations.filter((g) => g.state !== 'retired' && g.holders.includes(node.name));

  return mine.length
    ? {
        generations: mine.map((g) => ({
          generation: g.generation,
          replicationFactor: g.replicationFactor,
          ports: objectStorePorts(g.generation),
          zone: node.site,
        })),
      }
    : undefined;
}

/** Registry instances on a control-plane member, stored in the active generation. */
export function registryRole(
  node: Node,
  members: ReadonlySet<string>,
  nodes: readonly Node[],
  generations: readonly Generation[],
  registry: ClusterRegistry,
  tokenRootCertificatePem: string,
  publicUrl: string,
): RegistryRole | undefined {
  const active = generations.find((g) => g.state === 'active');

  if (!members.has(node.name) || !active) return undefined;

  const s3Node = active.holders.includes(node.name)
    ? node
    : nodes.find((n) => active.holders.includes(n.name) && overlay(n));
  const address = s3Node ? overlay(s3Node) : null;

  if (!address) return undefined;

  return {
    generation: active.generation,
    s3: { address, port: objectStorePorts(active.generation).s3 },
    bucket: REGISTRY_BUCKET,
    privatePort: REGISTRY_PRIVATE_PORT,
    mirrors: registry.mirrors.map((m, i) => ({ host: m.host, remoteUrl: m.remoteUrl, port: mirrorPort(i) })),
    readOnly: generations.some(
      (g) => g.state === 'copying' && (g.copy?.phase === 'final' || g.copy?.phase === 'sweep'),
    ),
    token: {
      issuer: REGISTRY_TOKEN_ISSUER,
      service: REGISTRY_TOKEN_SERVICE,
      realm: `${publicUrl.replace(/\/$/, '')}/api/registry/token`,
      rootCertificatePem: tokenRootCertificatePem,
    },
  };
}

/** Every node pulls through the members' registries once a generation is active. */
export function registryClient(
  nodes: readonly Node[],
  members: ReadonlySet<string>,
  generations: readonly Generation[],
  registry: ClusterRegistry,
): RegistryClient | undefined {
  if (!generations.some((g) => g.state === 'active')) return undefined;

  const endpoints = nodes
    .filter((n) => members.has(n.name))
    .map(overlay)
    .filter((a): a is string => !!a)
    .slice(0, 7);

  return endpoints.length
    ? {
        routerPort: REGISTRY_ROUTER_PORT,
        endpoints,
        privateHost: PRIVATE_REGISTRY_HOST,
        privatePort: REGISTRY_PRIVATE_PORT,
        mirrors: registry.mirrors.map((m, i) => ({ host: m.host, port: mirrorPort(i) })),
      }
    : undefined;
}

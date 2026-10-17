import { createHash } from 'node:crypto';

import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { ManagedContainerSpec } from '../host/managed-containers';

/** Images of the control-plane components, pinned by digest (section 6); overridden by the release bundle (3.26). */
export const DEFAULT_IMAGES = {
  etcd: 'quay.io/coreos/etcd:v3.5.21@sha256:a3ccd299377af4b9968d8cbaaf9722fe354297f11908f74a846075e1e5f4ee89',
  postgres: 'ghcr.io/zalando/spilo-17:4.0-p3@sha256:b7db9e8f62e809ebd9a0679fbdba147a811fdd240ab78380ea4720a46a017184',
  controlPlane: 'ghcr.io/forepath/loadweaver-control-plane-api:latest',
} as const;

export type ControlPlaneImages = { [K in keyof typeof DEFAULT_IMAGES]: string };

export function controlPlaneImages(env: NodeJS.ProcessEnv = process.env): ControlPlaneImages {
  return {
    etcd: env['LOADWEAVER_ETCD_IMAGE'] || DEFAULT_IMAGES.etcd,
    postgres: env['LOADWEAVER_POSTGRES_IMAGE'] || DEFAULT_IMAGES.postgres,
    controlPlane: env['LOADWEAVER_CONTROL_PLANE_IMAGE'] || DEFAULT_IMAGES.controlPlane,
  };
}

export const CONTAINER_NAMES = { etcd: 'lw-etcd', postgres: 'lw-postgres', controlPlane: 'lw-control-plane' } as const;
export type ControlPlaneComponent = keyof typeof CONTAINER_NAMES;

export { COMPONENT_LABEL, MANAGED_LABEL, SPEC_HASH_LABEL } from '../host/managed-containers';

export const ETCD_CLIENT_PORT = 2379;
export const ETCD_PEER_PORT = 2380;
export const PATRONI_PORT = 8008;
export const POSTGRES_PORT = 5432;
/** Local port of the leader proxy the API connects to (always the current Patroni leader). */
export const LEADER_PROXY_PORT = 5433;

export interface ContainerSpec extends ManagedContainerSpec {
  component: ControlPlaneComponent;
}

export function urlHost(address: string): string {
  return address.includes(':') ? `[${address}]` : address;
}

export interface MemberContext {
  nodeName: string;
  /** Address the components bind to: the overlay address, or loopback while bootstrapping. */
  address: string;
  stateDir: string;
  images: ControlPlaneImages;
}

function finish(spec: Omit<ContainerSpec, 'hash'>, hashInput: unknown): ContainerSpec {
  return { ...spec, hash: createHash('sha256').update(JSON.stringify(hashInput)).digest('hex').slice(0, 16) };
}

export function etcdPeerUrl(address: string): string {
  return `http://${urlHost(address)}:${ETCD_PEER_PORT}`;
}

export function etcdClientUrl(address: string): string {
  return `http://${urlHost(address)}:${ETCD_CLIENT_PORT}`;
}

/**
 * etcd member. Peer and client traffic between members only flows over the WireGuard overlay and is restricted to
 * control-plane members by the built-in quorum policy, so it authenticates through the node keys (3.3).
 * `initialCluster` only matters for a new data directory and is therefore not part of the hash.
 */
export function etcdSpec(
  ctx: MemberContext,
  role: ControlPlaneRole,
  initialState: 'new' | 'existing',
  initialCluster: string,
): ContainerSpec {
  const listenClients =
    ctx.address === '127.0.0.1'
      ? etcdClientUrl('127.0.0.1')
      : `${etcdClientUrl(ctx.address)},${etcdClientUrl('127.0.0.1')}`;
  const stable = [
    '--name',
    ctx.nodeName,
    '--data-dir',
    '/var/lib/etcd',
    '--listen-peer-urls',
    etcdPeerUrl(ctx.address),
    '--listen-client-urls',
    listenClients,
    '--advertise-client-urls',
    etcdClientUrl(ctx.address),
    '--initial-advertise-peer-urls',
    etcdPeerUrl(ctx.address),
    '--auto-compaction-retention',
    '1',
    '--quota-backend-bytes',
    String(2 * 1024 ** 3),
  ];

  return finish(
    {
      name: CONTAINER_NAMES.etcd,
      image: ctx.images.etcd,
      cmd: [
        'etcd',
        ...stable,
        '--initial-cluster',
        initialCluster,
        '--initial-cluster-state',
        initialState,
        '--initial-cluster-token',
        role.scope,
      ],
      env: {},
      binds: [`${ctx.stateDir}/etcd:/var/lib/etcd`],
      memoryBytes: 512 * 1024 ** 2,
      component: 'etcd',
    },
    { image: ctx.images.etcd, stable },
  );
}

/** Patroni + Postgres + TimescaleDB (Spilo) on control-plane members (3.2, 3.13). */
export function postgresSpec(ctx: MemberContext, role: ControlPlaneRole): ContainerSpec {
  const env = role.environment ?? {};
  const etcdHosts = role.members.map((m) => `${urlHost(m.address)}:${ETCD_CLIENT_PORT}`).join(',');
  const containerEnv: Record<string, string> = {
    SCOPE: role.scope,
    PGVERSION: '17',
    SPILO_PROVIDER: 'local',
    ETCD3_HOSTS: etcdHosts,
    ETCD3_PROTOCOL: 'http',
    POD_IP: ctx.address,
    PGUSER_SUPERUSER: env['DB_USERNAME'] || 'postgres',
    PGPASSWORD_SUPERUSER: env['DB_PASSWORD'] ?? '',
    PGPASSWORD_STANDBY: env['LOADWEAVER_POSTGRES_REPLICATION_PASSWORD'] ?? '',
    PGPASSWORD_ADMIN: env['LOADWEAVER_POSTGRES_ADMIN_PASSWORD'] ?? '',
    PGROOT: '/home/postgres/pgdata/pgroot',
  };

  return finish(
    {
      name: CONTAINER_NAMES.postgres,
      image: ctx.images.postgres,
      env: containerEnv,
      binds: [`${ctx.stateDir}/postgres:/home/postgres/pgdata`],
      memoryBytes: 1024 ** 3,
      component: 'postgres',
    },
    { image: ctx.images.postgres, containerEnv },
  );
}

/** The control-plane API itself; reaches the database through the local leader proxy. */
export function controlPlaneApiSpec(ctx: MemberContext, role: ControlPlaneRole): ContainerSpec {
  const containerEnv: Record<string, string> = {
    ...(role.environment ?? {}),
    NODE_ENV: 'production',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(LEADER_PROXY_PORT),
    LOADWEAVER_CLUSTER_ID: role.scope,
    // Agents switch to the overlay address once their tunnel is up (3.21), so it must be in the serving certificate.
    LOADWEAVER_GRPC_HOSTNAMES: [
      ...new Set([...(role.environment?.['LOADWEAVER_GRPC_HOSTNAMES'] ?? 'localhost').split(','), ctx.address]),
    ].join(','),
  };

  return finish(
    {
      name: CONTAINER_NAMES.controlPlane,
      image: ctx.images.controlPlane,
      env: containerEnv,
      binds: [],
      memoryBytes: 768 * 1024 ** 2,
      component: 'controlPlane',
    },
    { image: ctx.images.controlPlane, containerEnv },
  );
}

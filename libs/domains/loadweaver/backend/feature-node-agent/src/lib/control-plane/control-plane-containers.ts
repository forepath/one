import { createHash } from 'node:crypto';

import type { ControlPlaneRole, PostgresTls } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import type { ManagedContainerSpec } from '../host/managed-containers';
import { componentImage } from '../updates/release-images';
import { logStoreApiEnvironment } from './log-store';
import { gatewayListenEnvironment, spiloBackupEnvironment } from './platform-backups';
import { apiDatabaseTlsEnvironment, spiloTlsEnvironment } from './postgres-tls';

/**
 * Images of the control-plane components: this build's pins (section 6, `COMPONENT_IMAGES`), replaced by the images
 * of the release the node runs (3.26).
 */
export const DEFAULT_IMAGES = {
  etcd: COMPONENT_IMAGES.etcd,
  postgres: COMPONENT_IMAGES.postgres,
  queue: COMPONENT_IMAGES.valkey,
  controlPlane: COMPONENT_IMAGES['control-plane'],
} as const;

export type ControlPlaneImages = { [K in keyof typeof DEFAULT_IMAGES]: string };

export function controlPlaneImages(env: NodeJS.ProcessEnv = process.env): ControlPlaneImages {
  return {
    etcd: componentImage('etcd', env),
    postgres: componentImage('postgres', env),
    queue: componentImage('valkey', env),
    controlPlane: componentImage('control-plane', env),
  };
}

export const CONTAINER_NAMES = {
  etcd: 'lw-etcd',
  postgres: 'lw-postgres',
  queue: 'lw-queue',
  controlPlane: 'lw-control-plane',
} as const;
/** Valkey on loopback for the API's job queue (notification deliveries); per member, not shared. */
export const QUEUE_PORT = 6391;
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
  /** The member's queue password (generated once, kept in the state directory). */
  queuePassword?: string;
  /** The Postgres server certificate Spilo serves (cluster CA); none yet while bootstrapping. */
  postgresTls?: PostgresTls | null;
  /** Patroni scope of the member's database (after a cut-over not the cluster scope, 3.20). */
  postgresScope?: string;
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

/** Every voter's etcd (operators' tools; the member's own Patroni uses `LOCAL_ETCD_HOSTS`). */
export function postgresEtcdHosts(role: ControlPlaneRole): string {
  return role.members.map((m) => `${urlHost(m.address)}:${ETCD_CLIENT_PORT}`).join(',');
}

/**
 * Patroni on a member talks to the member's own etcd (always on loopback, see `etcdSpec`), which is part of the
 * cluster: the Spilo spec then doesn't change when members join or leave. A list of every voter re-created the
 * leader's Postgres on each membership change, and a just-added member whose etcd didn't run yet kept Patroni's
 * client timing out until it lost the leader lock — the primary came back read-only and the cluster could not write
 * the new member's hello (found in the DR drill). A partitioned member loses its DCS either way (and demotes).
 */
export const LOCAL_ETCD_HOSTS = `127.0.0.1:${ETCD_CLIENT_PORT}`;

/** Patroni + Postgres + TimescaleDB (Spilo) on control-plane members (3.2, 3.13). */
export function postgresSpec(ctx: MemberContext, role: ControlPlaneRole): ContainerSpec {
  const env = role.environment ?? {};
  const etcdHosts = LOCAL_ETCD_HOSTS;
  const containerEnv: Record<string, string> = {
    SCOPE: ctx.postgresScope ?? role.scope,
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
    // WAL archiving through the member's backup gateway (3.20); absent without the `platform-backups` feature.
    ...spiloBackupEnvironment(role),
    // The member's certificate from the cluster CA; Spilo generates a self-signed one without (bootstrap).
    ...spiloTlsEnvironment(ctx.postgresTls),
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

/** The API's job queue on loopback, persisted so queued deliveries survive a restart. */
export function queueSpec(ctx: MemberContext): ContainerSpec {
  const cmd = [
    'valkey-server',
    '--bind',
    '127.0.0.1',
    '--port',
    String(QUEUE_PORT),
    '--appendonly',
    'yes',
    '--dir',
    '/data',
    '--protected-mode',
    'yes',
    // Local processes on the member can't read or enqueue deliveries without it.
    ...(ctx.queuePassword ? ['--requirepass', ctx.queuePassword] : []),
  ];

  return finish(
    {
      name: CONTAINER_NAMES.queue,
      image: ctx.images.queue,
      cmd,
      env: {},
      binds: [`${ctx.stateDir}/queue:/data`],
      memoryBytes: 128 * 1024 ** 2,
      component: 'queue',
    },
    { image: ctx.images.queue, cmd },
  );
}

/** The control-plane API itself; reaches the database through the local leader proxy. */
export function controlPlaneApiSpec(ctx: MemberContext, role: ControlPlaneRole): ContainerSpec {
  const containerEnv: Record<string, string> = {
    ...(role.environment ?? {}),
    NODE_ENV: 'production',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(LEADER_PROXY_PORT),
    // TLS through the leader proxy to whichever member leads, verified against the cluster CA.
    ...apiDatabaseTlsEnvironment(ctx.postgresTls),
    LOADWEAVER_CLUSTER_ID: role.scope,
    // The member's own job queue (notification deliveries, 3.18).
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(QUEUE_PORT),
    REDIS_KEY_PREFIX: 'loadweaver',
    // Reports and other control-plane files on the cluster's object store (3.25); an operator may override.
    FILE_STORAGE_PROVIDER: role.environment?.['FILE_STORAGE_PROVIDER'] || 'garage',
    ...(ctx.queuePassword ? { REDIS_PASSWORD: ctx.queuePassword } : {}),
    // The member's own log store (3.14).
    ...logStoreApiEnvironment(ctx.address, role),
    // The backup gateway for WAL-G / OpenSearch on this member (3.20).
    ...gatewayListenEnvironment(role),
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

import { createHash } from 'node:crypto';

import type { ControlPlaneRole, PostgresTls } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import type { ManagedContainerSpec } from '../host/managed-containers';
import { componentImage } from '../updates/release-images';
import { logStoreApiEnvironment } from './log-store';
import {
  gatewayListenEnvironment,
  SPILO_WALG_CONFIG,
  SPILO_WALG_CONFIG_FILE,
  SPILO_WALG_CONFIG_PATH,
  spiloBackupEnvironment,
} from './platform-backups';
import { apiDatabaseTlsEnvironment, SPILO_TLS_FILE_ENVIRONMENT } from './postgres-tls';

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

/**
 * Connect addresses (3.43, user decision 2026-10-30): Spilo derives Patroni's `postgresql.connect_address` and
 * `restapi.connect_address` from `gethostbyname(hostname)`, which is `127.0.1.1` on Debian hosts, so replicas
 * "streamed" from themselves and only followed through the WAL archive. Spilo's template takes both from the
 * placeholders `PG_CONNECT_ADDRESS` / `RESTAPI_CONNECT_ADDRESS` (plain environment, `setdefault` in
 * `configure_spilo.py`; unlike `PATRONI_*` they are neither stripped nor overridden), and listens on every address
 * anyway. They carry the member's overlay address, independent of `/etc/hosts`; while bootstrapping on loopback they
 * are left out (no use to other members).
 *
 * They are not part of the spec hash: the loopback → overlay switch after `bootstrap` and the rollout to running
 * members must not re-create Postgres ("bootstrap with the final config", 2026-10-27). A running Spilo gets them in
 * place instead (`postgresConnectSyncCommand`, Patroni reloads both without a restart); a (re-)created one from here.
 */
export function postgresConnectEnvironment(address: string): Record<string, string> {
  if (isLoopback(address)) return {};

  return {
    PG_CONNECT_ADDRESS: `${urlHost(address)}:${POSTGRES_PORT}`,
    RESTAPI_CONNECT_ADDRESS: `${urlHost(address)}:${PATRONI_PORT}`,
  };
}

function isLoopback(address: string): boolean {
  return address === '::1' || address === 'localhost' || address.startsWith('127.');
}

/** Exit code of `postgresConnectSyncCommand` when it changed the addresses (and reloaded Patroni). */
export const POSTGRES_CONNECT_CHANGED_EXIT = 10;

/**
 * Sets Patroni's connect addresses in a running Spilo's generated config (`/home/postgres/postgres.yml`, regenerated
 * from the environment on each container start) and reloads Patroni through its REST API. Exit 0: already set,
 * `POSTGRES_CONNECT_CHANGED_EXIT`: changed and reloaded; anything else is a failure. Runs as `postgres` (the file's owner). Arguments are the
 * values of `postgresConnectEnvironment`.
 */
export function postgresConnectSyncCommand(connect: Record<string, string>): string[] {
  const script = [
    'import os, sys, yaml, urllib.request',
    "path = os.path.realpath('/home/postgres/postgres.yml')",
    'with open(path) as f: config = yaml.safe_load(f)',
    "want = {'postgresql': sys.argv[1], 'restapi': sys.argv[2]}",
    "if all((config.get(k) or {}).get('connect_address') == v for k, v in want.items()): sys.exit(0)",
    "for k, v in want.items(): config.setdefault(k, {})['connect_address'] = v",
    "with open(path, 'w') as f: yaml.safe_dump(config, f, default_flow_style=False)",
    `urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:${PATRONI_PORT}/reload', method='POST'), timeout=10)`,
    `sys.exit(${POSTGRES_CONNECT_CHANGED_EXIT})`,
  ].join('\n');

  return ['python3', '-c', script, connect['PG_CONNECT_ADDRESS'], connect['RESTAPI_CONNECT_ADDRESS']];
}

/** Exit codes of `POSTGRES_ROLE_PASSWORDS_COMMAND` besides 0 (already set) and failures. */
export const POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT = 10;
export const POSTGRES_ROLE_PASSWORDS_REPLICA_EXIT = 11;

/**
 * Spilo's roles whose password comes from the member's environment, and the exec variable carrying it to
 * `POSTGRES_ROLE_PASSWORDS_COMMAND` (never an argument: arguments show in every process list).
 */
const SPILO_ROLE_PASSWORDS = [
  { role: 'standby', env: 'LOADWEAVER_POSTGRES_REPLICATION_PASSWORD', exec: 'LW_ROLE_PASSWORD_STANDBY' },
  { role: 'admin', env: 'LOADWEAVER_POSTGRES_ADMIN_PASSWORD', exec: 'LW_ROLE_PASSWORD_ADMIN' },
] as const;

/**
 * The exec environment of `POSTGRES_ROLE_PASSWORDS_COMMAND`: the wanted passwords of Spilo's `standby` / `admin` roles
 * and the superuser it connects as; empty when the member's environment sets neither password.
 */
export function postgresRolePasswordsExecEnvironment(role: ControlPlaneRole): Record<string, string> {
  const env = role.environment ?? {};
  const wanted = Object.fromEntries(
    SPILO_ROLE_PASSWORDS.filter((r) => env[r.env]).map((r) => [r.exec, env[r.env] as string]),
  );

  if (Object.keys(wanted).length === 0) return {};

  return { ...wanted, PGUSER: env['DB_USERNAME'] || 'postgres', PGPASSWORD: env['DB_PASSWORD'] ?? '' };
}

/**
 * Sets the passwords of Spilo's `standby` / `admin` roles on the leader when they differ (user decision 2026-10-30):
 * Spilo only sets them when it bootstraps a data directory, so a cluster that ran without them (or with other ones)
 * never got the new values and its replicas couldn't stream. Runs as `postgres` in the member's Spilo over the local
 * socket. The passwords come in through the exec environment, are compared against the stored SCRAM / MD5 verifier,
 * and only a SCRAM verifier computed here goes to the server, in a session that doesn't log statements (the earlier
 * manual `ALTER ROLE` leaked into the CSV log). Exit 0: already set, `POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT`: changed,
 * `POSTGRES_ROLE_PASSWORDS_REPLICA_EXIT`: a replica (the leader's change replicates), anything else is a failure;
 * prints nothing.
 */
export const POSTGRES_ROLE_PASSWORDS_COMMAND: string[] = [
  'python3',
  '-c',
  [
    'import base64, hashlib, hmac, os, sys',
    'try:',
    '    import psycopg2 as pg',
    '    from psycopg2 import sql',
    'except ImportError:',
    '    import psycopg as pg',
    '    from psycopg import sql',
    `roles = {${SPILO_ROLE_PASSWORDS.map((r) => `'${r.role}': '${r.exec}'`).join(', ')}}`,
    'want = {role: os.environ.get(var, "") for role, var in roles.items()}',
    'want = {role: password for role, password in want.items() if password}',
    'def scram(password, salt, iterations):',
    "    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)",
    "    stored = hashlib.sha256(hmac.new(salted, b'Client Key', 'sha256').digest()).digest()",
    "    server = hmac.new(salted, b'Server Key', 'sha256').digest()",
    '    b64 = lambda b: base64.b64encode(b).decode()',
    "    return 'SCRAM-SHA-256$%d:%s$%s:%s' % (iterations, b64(salt), b64(stored), b64(server))",
    'def matches(stored, role, password):',
    '    try:',
    "        if stored.startswith('SCRAM-SHA-256$'):",
    "            iterations, salt = stored.split('$')[1].split(':')",
    '            return hmac.compare_digest(scram(password, base64.b64decode(salt), int(iterations)), stored)',
    "        if stored.startswith('md5'):",
    "            return hmac.compare_digest('md5' + hashlib.md5((password + role).encode()).hexdigest(), stored)",
    '    except Exception:',
    '        pass',
    '    return False',
    'if not want: sys.exit(0)',
    'changed = False',
    'try:',
    "    conn = pg.connect(host='/var/run/postgresql', port=5432, dbname='postgres', connect_timeout=5)",
    '    conn.autocommit = True',
    '    cur = conn.cursor()',
    "    for setting in (\"log_statement = 'none'\", 'log_min_duration_statement = -1', \"log_min_error_statement = 'panic'\", 'pg_stat_statements.track_utility = off'):",
    "        cur.execute('SET ' + setting)",
    "    cur.execute('SELECT pg_is_in_recovery()')",
    `    if cur.fetchone()[0]: sys.exit(${POSTGRES_ROLE_PASSWORDS_REPLICA_EXIT})`,
    '    for role, password in sorted(want.items()):',
    "        cur.execute('SELECT rolpassword FROM pg_authid WHERE rolname = %s', (role,))",
    '        row = cur.fetchone()',
    '        if row is None or (row[0] and matches(row[0], role, password)): continue',
    '        verifier = scram(password, os.urandom(16), 4096)',
    "        cur.execute(sql.SQL('ALTER ROLE {} PASSWORD {}').format(sql.Identifier(role), sql.Literal(verifier)))",
    '        changed = True',
    'except Exception:',
    '    sys.exit(1)',
    `sys.exit(${POSTGRES_ROLE_PASSWORDS_CHANGED_EXIT} if changed else 0)`,
  ].join('\n'),
];

/**
 * Patroni + Postgres + TimescaleDB (Spilo) on control-plane members (3.2, 3.13).
 *
 * The spec carries only what `bootstrap` already knows (user decision 2026-10-27 "bootstrap with the final config"),
 * so the first apply and later membership changes never re-create the database container — a re-created Spilo came
 * back read-only for 45 s to > 2 min. Hence: the local etcd instead of the voters (`LOCAL_ETCD_HOSTS`), the
 * certificate from files (`SPILO_TLS_FILE_ENVIRONMENT`, reloaded in place), WAL-G settings derived from the
 * encryption key (`bootstrap` passes the same `platformBackups`). Spilo's local provider ignores `POD_IP` (only read
 * under Kubernetes); the member's address goes in as Spilo's connect addresses (`postgresConnectEnvironment`).
 */
export function postgresSpec(ctx: MemberContext, role: ControlPlaneRole): ContainerSpec {
  const env = role.environment ?? {};
  const etcdHosts = LOCAL_ETCD_HOSTS;
  const containerEnv: Record<string, string> = {
    SCOPE: ctx.postgresScope ?? role.scope,
    PGVERSION: '17',
    SPILO_PROVIDER: 'local',
    ETCD3_HOSTS: etcdHosts,
    ETCD3_PROTOCOL: 'http',
    PGUSER_SUPERUSER: env['DB_USERNAME'] || 'postgres',
    PGPASSWORD_SUPERUSER: env['DB_PASSWORD'] ?? '',
    PGPASSWORD_STANDBY: env['LOADWEAVER_POSTGRES_REPLICATION_PASSWORD'] ?? '',
    PGPASSWORD_ADMIN: env['LOADWEAVER_POSTGRES_ADMIN_PASSWORD'] ?? '',
    PGROOT: '/home/postgres/pgdata/pgroot',
    ...postgresConnectEnvironment(ctx.address),
    // WAL archiving through the member's backup gateway (3.20); absent without the `platform-backups` feature.
    ...spiloBackupEnvironment(role),
    // The member's certificate from the cluster CA in the data volume; Spilo generates a self-signed one there
    // while none is installed (bootstrap).
    ...SPILO_TLS_FILE_ENVIRONMENT,
  };

  // Bounded WAL-G retries (`SPILO_WALG_CONFIG`, written by the role manager) wherever WAL-G archives.
  const walg = 'USE_WALG_BACKUP' in containerEnv;
  // Applied in place to a running Spilo, see `postgresConnectEnvironment`.
  const hashedEnv = { ...containerEnv };

  delete hashedEnv['PG_CONNECT_ADDRESS'];
  delete hashedEnv['RESTAPI_CONNECT_ADDRESS'];

  return finish(
    {
      name: CONTAINER_NAMES.postgres,
      image: ctx.images.postgres,
      env: containerEnv,
      binds: [
        `${ctx.stateDir}/postgres:/home/postgres/pgdata`,
        ...(walg ? [`${ctx.stateDir}/${SPILO_WALG_CONFIG_FILE}:${SPILO_WALG_CONFIG_PATH}:ro`] : []),
      ],
      memoryBytes: 1024 ** 3,
      component: 'postgres',
    },
    walg
      ? { image: ctx.images.postgres, containerEnv: hashedEnv, walg: SPILO_WALG_CONFIG }
      : { image: ctx.images.postgres, containerEnv: hashedEnv },
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
    // The member's own job queue (notification deliveries, 3.18), through the shared Valkey GLIDE client.
    CACHE_CLIENT: 'glide',
    VALKEY_HOST: '127.0.0.1',
    VALKEY_PORT: String(QUEUE_PORT),
    VALKEY_KEY_PREFIX: 'loadweaver',
    // Reports and other control-plane files on the cluster's object store (3.25); an operator may override.
    FILE_STORAGE_PROVIDER: role.environment?.['FILE_STORAGE_PROVIDER'] || 'garage',
    ...(ctx.queuePassword ? { VALKEY_PASSWORD: ctx.queuePassword } : {}),
    // The member's own log store (3.14).
    ...logStoreApiEnvironment(ctx.address, role),
    // The backup gateway for WAL-G / OpenSearch on this member (3.20).
    ...gatewayListenEnvironment(role),
    // Agents switch to the overlay address once their tunnel is up (3.21), so it must be in the serving certificate.
    LOADWEAVER_GRPC_HOSTNAMES: [
      ...new Set([...(role.environment?.['LOADWEAVER_GRPC_HOSTNAMES'] ?? 'localhost').split(','), ctx.address]),
    ].join(','),
    // Member CPs never host the built-in control-plane member (3.39): the node's own seal key holds the share. Forced
    // after the replicated environment so no setting can turn it on here.
    LOADWEAVER_BUILTIN_MEMBER: 'off',
    // This API runs on a member (3.43): the members' database always was the database, never a handover from here.
    LOADWEAVER_CONTROL_PLANE_ON_MEMBER: 'true',
  };
  // Sorted: the replicated environment follows the sending control plane's process environment, whose order differs
  // between replicas (the compose API vs. a member's own replica). Unsorted, the same settings gave another hash per
  // sender and the agent re-created the replica on every switch of its stream (live 3.43).
  const env = Object.fromEntries(Object.entries(containerEnv).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

  return finish(
    {
      name: CONTAINER_NAMES.controlPlane,
      image: ctx.images.controlPlane,
      env,
      binds: [],
      memoryBytes: 768 * 1024 ** 2,
      component: 'controlPlane',
    },
    { image: ctx.images.controlPlane, containerEnv: env },
  );
}

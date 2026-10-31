import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Whole-cluster disaster recovery on a fresh node (3.20, `loadweaver-agent bootstrap --restore`), pure parts: the
 * target the external copy lives on (DR info file or flags), the request for the control-plane image's DR tool, the
 * restored control plane's environment and the scripts that restore Postgres and etcd.
 */

/** The external target as the DR tool takes it (a `BackupTarget` spec without the secret references). */
export type DrTarget =
  | { type: 's3'; endpoint: string; bucket: string; region: string; prefix: string; credentials: string }
  | { type: 'sftp'; host: string; port: number; user: string; path: string; knownHosts: string; keySecret: string };

export interface DrInfoFile {
  format: 'loadweaver-dr-info';
  version: 1;
  clusterId: string;
  postgresScope?: string;
  targets: Array<{
    name: string;
    type: 's3' | 'sftp';
    endpoint?: string;
    bucket?: string;
    region?: string;
    prefix?: string;
    host?: string;
    port?: number;
    user?: string;
    path?: string;
    knownHosts?: string;
  }>;
}

export interface RestoreOptions {
  nodeName: string;
  publicHost: string;
  target: DrTarget;
  /** S3 access key or the SFTP private key (given at restore time; the cluster's secrets are what is being restored). */
  credentials: { accessKeyId: string; secretAccessKey: string } | { privateKey: string };
  key: { shares: string[] } | { kms: { provider: 'vault-transit'; env: Record<string, string> } };
  targetTime?: string;
  restoreVolumes: boolean;
  /** Keep the downloaded (decrypted) backup after the restore, for inspection. Off by default. */
  keepStaging?: boolean;
}

const NODE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SECRET_PREFIX_PLACEHOLDER = 'dr-restore';

/** The target from a DR info file (first one, or by name). */
export function targetFromDrInfo(info: DrInfoFile, name?: string): DrTarget {
  if (info.format !== 'loadweaver-dr-info' || info.version !== 1) throw new Error('not a Loadweaver DR info file');

  const target = name ? info.targets.find((t) => t.name === name) : info.targets[0];

  if (!target) throw new Error(name ? `the DR info has no target ${name}` : 'the DR info names no external target');

  if (target.type === 's3') {
    if (!target.endpoint || !target.bucket) throw new Error(`target ${target.name}: endpoint and bucket missing`);

    return {
      type: 's3',
      endpoint: target.endpoint,
      bucket: target.bucket,
      region: target.region ?? 'us-east-1',
      prefix: target.prefix ?? '',
      credentials: `secret://${SECRET_PREFIX_PLACEHOLDER}/s3`,
    };
  }

  if (!target.host || !target.user || !target.path || !target.knownHosts)
    throw new Error(`target ${target.name}: host, user, path and known_hosts are needed`);

  return {
    type: 'sftp',
    host: target.host,
    port: target.port ?? 22,
    user: target.user,
    path: target.path,
    knownHosts: target.knownHosts,
    keySecret: `secret://${SECRET_PREFIX_PLACEHOLDER}/sftp-key`,
  };
}

export interface RestoreFlags {
  name?: string;
  'public-host'?: string;
  'dr-info'?: string;
  target?: string;
  's3-endpoint'?: string;
  's3-bucket'?: string;
  's3-region'?: string;
  's3-prefix'?: string;
  'sftp-host'?: string;
  'sftp-port'?: string;
  'sftp-user'?: string;
  'sftp-path'?: string;
  'known-hosts-file'?: string;
  'sftp-key-file'?: string;
  'share-file'?: string[];
  kms?: string;
  'target-time'?: string;
  'no-volume-restore'?: boolean;
  'keep-staging'?: boolean;
}

/**
 * Validates `bootstrap --restore` flags into what the restore needs, given the files the flags name (read by the
 * caller) and the environment (S3 keys, KMS settings). Shares not given as files are asked for interactively.
 */
export function restoreOptionsFrom(
  flags: RestoreFlags,
  files: { drInfo?: string; knownHosts?: string; sftpKey?: string; shares: string[] },
  env: NodeJS.ProcessEnv,
): Omit<RestoreOptions, 'key'> & { key: RestoreOptions['key'] | null } {
  if (!flags.name || !NODE_NAME.test(flags.name)) throw new Error('bootstrap --restore needs --name <node>');

  if (!flags['public-host']) throw new Error('bootstrap --restore needs --public-host <host>');

  let target: DrTarget;

  if (files.drInfo) {
    target = targetFromDrInfo(JSON.parse(files.drInfo) as DrInfoFile, flags.target);
  } else if (flags['s3-endpoint'] || flags['s3-bucket']) {
    if (!flags['s3-endpoint'] || !flags['s3-bucket']) throw new Error('--s3-endpoint and --s3-bucket go together');

    if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/.test(flags['s3-endpoint']))
      throw new Error('--s3-endpoint must be an http(s) URL');

    target = {
      type: 's3',
      endpoint: flags['s3-endpoint'],
      bucket: flags['s3-bucket'],
      region: flags['s3-region'] ?? 'us-east-1',
      prefix: flags['s3-prefix'] ?? '',
      credentials: `secret://${SECRET_PREFIX_PLACEHOLDER}/s3`,
    };
  } else if (flags['sftp-host']) {
    if (!flags['sftp-user'] || !flags['sftp-path'] || !files.knownHosts)
      throw new Error('an SFTP target needs --sftp-user, --sftp-path and --known-hosts-file');

    target = {
      type: 'sftp',
      host: flags['sftp-host'],
      port: Number(flags['sftp-port'] ?? 22),
      user: flags['sftp-user'],
      path: flags['sftp-path'],
      knownHosts: files.knownHosts,
      keySecret: `secret://${SECRET_PREFIX_PLACEHOLDER}/sftp-key`,
    };
  } else {
    throw new Error('name the external target: --dr-info <file> (from the console) or --s3-* / --sftp-* flags');
  }

  let credentials: RestoreOptions['credentials'];

  if (target.type === 's3') {
    const accessKeyId = env['LOADWEAVER_DR_ACCESS_KEY_ID'];
    const secretAccessKey = env['LOADWEAVER_DR_SECRET_ACCESS_KEY'];

    if (!accessKeyId || !secretAccessKey)
      throw new Error(
        'set LOADWEAVER_DR_ACCESS_KEY_ID and LOADWEAVER_DR_SECRET_ACCESS_KEY (read access to the target is enough)',
      );

    credentials = { accessKeyId, secretAccessKey };
  } else {
    if (!files.sftpKey) throw new Error('an SFTP target needs --sftp-key-file');

    credentials = { privateKey: files.sftpKey };
  }

  if (flags.kms && files.shares.length) throw new Error('use either --share-file or --kms, not both');

  let key: RestoreOptions['key'] | null = null;

  if (flags.kms) {
    if (flags.kms !== 'vault-transit') throw new Error('--kms supports vault-transit');

    const kmsEnv = Object.fromEntries(
      ['VAULT_ADDR', 'VAULT_TOKEN', 'VAULT_NAMESPACE', 'LOADWEAVER_VAULT_TRANSIT_MOUNT', 'LOADWEAVER_VAULT_TRANSIT_KEY']
        .filter((k) => env[k])
        .map((k) => [k, env[k] as string]),
    );

    if (!kmsEnv['VAULT_ADDR'] || !kmsEnv['VAULT_TOKEN'])
      throw new Error('--kms vault-transit needs VAULT_ADDR and VAULT_TOKEN');

    key = { kms: { provider: 'vault-transit', env: kmsEnv } };
  } else if (files.shares.length) {
    key = { shares: files.shares };
  }

  if (flags['target-time'] && Number.isNaN(new Date(flags['target-time']).getTime()))
    throw new Error('--target-time must be an ISO 8601 time');

  return {
    nodeName: flags.name,
    publicHost: flags['public-host'],
    target,
    credentials,
    key,
    ...(flags['target-time'] ? { targetTime: new Date(flags['target-time']).toISOString() } : {}),
    restoreVolumes: !flags['no-volume-restore'],
    keepStaging: !!flags['keep-staging'],
  };
}

/** The request file for the DR tool (`node main.js dr <file>` in the control-plane image). */
export function drToolRequest(options: RestoreOptions, outputDir: string): Record<string, unknown> {
  return {
    target: options.target,
    credentials: options.credentials,
    key: options.key,
    ...(options.targetTime ? { targetTime: options.targetTime } : {}),
    outputDir,
  };
}

/** What the DR tool writes to `result.json`. */
export interface DrToolResult {
  clusterId: string;
  postgresScope: string;
  backup: string;
  backupFinishedAt: string | null;
  generation: number;
  walgPrefix: string;
  etcdSnapshot: string | null;
  env: Record<string, string>;
  masterKey: { id: string; value: string };
  objects: number;
  bytes: number;
}

/** One-time values of a recovery: its id, the join token of this node, the secret for `/api/dr/*`. */
export function recoveryIdentity(joinToken: string): { id: string; token: string; secret: string } {
  return { id: randomUUID(), token: joinToken, secret: randomBytes(32).toString('base64url') };
}

/**
 * The restored control plane's environment: the envelope's (secrets, auth settings) plus what belongs to this node
 * (public host) and the one-time recovery settings for the API's first start.
 */
export function restoredEnvironment(
  result: Pick<DrToolResult, 'clusterId' | 'env'>,
  options: Pick<RestoreOptions, 'nodeName' | 'publicHost' | 'restoreVolumes' | 'key'>,
  recovery: { id: string; token: string; secret: string },
): Record<string, string> {
  const env = result.env;

  return {
    ...env,
    DB_USERNAME: env['DB_USERNAME'] || 'postgres',
    DB_DATABASE: env['DB_DATABASE'] || 'postgres',
    AUTHENTICATION_METHOD: env['AUTHENTICATION_METHOD'] || 'users',
    LOADWEAVER_CLUSTER_ID: result.clusterId,
    LOADWEAVER_GRPC_HOSTNAMES: `localhost,127.0.0.1,${options.publicHost}`,
    LOADWEAVER_GRPC_ENDPOINTS: `${options.publicHost}:7443`,
    // A master key held by the KMS unwraps through it again: the operator's KMS credentials.
    ...(options.key && 'kms' in options.key ? options.key.kms.env : {}),
    LOADWEAVER_DR_RECOVERY: JSON.stringify({
      id: recovery.id,
      node: options.nodeName,
      token: recovery.token,
      secret: recovery.secret,
      restoreVolumes: options.restoreVolumes,
    }),
  };
}

/**
 * Restores the base backup into Spilo's data directory and replays the WAL (to the end of the copied archive, or the
 * target time), then stops: Patroni takes the promoted data directory over as the new cluster's leader. Runs in a
 * one-shot container of the Spilo image (as root; drops to `postgres` for WAL-G and Postgres) without network.
 */
export function postgresRestoreScript(input: { walgPrefix: string; backup: string; targetTime?: string }): string {
  if (!/^[A-Za-z0-9/_.-]+$/.test(input.walgPrefix) || input.walgPrefix.includes('..'))
    throw new Error('unsafe WAL-G prefix');

  if (!/^base_[0-9A-F]{24}(_D_[0-9A-F]{24})?$/.test(input.backup)) throw new Error('invalid base backup name');

  const target = input.targetTime ? new Date(input.targetTime) : null;

  if (target && Number.isNaN(target.getTime())) throw new Error('invalid target time');

  const recoveryTarget = target
    ? `-c recovery_target_time='${target.toISOString().replace('T', ' ').replace('Z', '+00:00')}' -c recovery_target_action=promote`
    : '';

  return [
    'set -euo pipefail',
    'DATA=/home/postgres/pgdata/pgroot/data',
    'PGBIN=$(ls -d /usr/lib/postgresql/17/bin)',
    `export WALG_FILE_PREFIX=/dr/${input.walgPrefix}`,
    'mkdir -p /home/postgres/pgdata/pgroot',
    'rm -rf "$DATA"',
    'chown -R postgres:postgres /home/postgres/pgdata /dr',
    `runuser -u postgres -- env WALG_FILE_PREFIX="$WALG_FILE_PREFIX" wal-g backup-fetch "$DATA" ${input.backup}`,
    'touch "$DATA/recovery.signal" && chown postgres:postgres "$DATA/recovery.signal"',
    // Spilo's runtime settings don't exist here: no TLS files, no archive, no TCP, a private socket directory.
    `runuser -u postgres -- "$PGBIN/pg_ctl" -D "$DATA" -w -t 7200 -l /tmp/restore.log start -o "-c ssl=off -c archive_mode=off -c listen_addresses='' -c port=54329 -c unix_socket_directories=/tmp -c hot_standby=on -c restore_command='env WALG_FILE_PREFIX=$WALG_FILE_PREFIX wal-g wal-fetch %f %p' ${recoveryTarget}" || { cat /tmp/restore.log; exit 1; }`,
    'for i in $(seq 1 7200); do',
    '  state=$(runuser -u postgres -- "$PGBIN/psql" -h /tmp -p 54329 -d postgres -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || true)',
    '  [ "$state" = "f" ] && break',
    '  sleep 1',
    'done',
    '[ "$state" = "f" ] || { tail -n 50 /tmp/restore.log; echo "recovery did not finish" >&2; exit 1; }',
    'runuser -u postgres -- "$PGBIN/psql" -h /tmp -p 54329 -d postgres -tAc "SELECT \'restored to \' || now()::text || \', timeline \' || timeline_id FROM pg_control_checkpoint()"',
    'runuser -u postgres -- "$PGBIN/pg_ctl" -D "$DATA" -w -m fast stop',
    'rm -f "$DATA/recovery.signal"',
  ].join('\n');
}

/** `etcdutl snapshot restore` arguments: this node as the only member (others join as they come). */
export function etcdRestoreArgs(input: {
  snapshot: string;
  node: string;
  clusterId: string;
  dataDir: string;
}): string[] {
  return [
    'etcdutl',
    'snapshot',
    'restore',
    input.snapshot,
    '--data-dir',
    input.dataDir,
    '--name',
    input.node,
    '--initial-cluster',
    `${input.node}=http://127.0.0.1:2380`,
    '--initial-advertise-peer-urls',
    'http://127.0.0.1:2380',
    '--initial-cluster-token',
    input.clusterId,
  ];
}

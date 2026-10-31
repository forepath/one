import { createHmac, scryptSync } from 'node:crypto';

import { z } from 'zod';

import { isIp } from '@forepath/loadweaver/shared/util-network';

import { replicaIdSchema, volumeIdSchema } from './live';

/**
 * Backups over the node stream (3.20, protocol v2, feature `backups`).
 *
 * Repositories: one Kopia repository per trust boundary (`cluster`, `project-<name>`) in the object store, served
 * by Kopia repository servers on the control-plane members (desired state `backupServer`). Nodes never hold object
 * store keys: they connect to a repository server over TLS (certificate fingerprint pinned) as a Kopia user with
 * APPEND / READ on its own snapshots only (`KOPIA_ACL_RULES`); snapshot deletion, changes to other policies and
 * maintenance are refused for them (their own source policies they may write — Kopia marks stdin sources `manual` —
 * and the control plane re-asserts those before every retention run). The control plane's user has FULL access (retention, catalog, diff, user management); the
 * server process runs maintenance under the control plane's identity.
 *
 * Volume identities: each volume backs up as its own Kopia user `v-<deployment>.<volume>@<project>` (path
 * `/volume`), so a restore onto any node only needs that volume's credentials, handed out per command.
 *
 * Commands (control plane → agent, channel `backup:<id>`, gated by `backups`): `backupRun` (LVM thin snapshot of
 * the volume's LV, opened read-only with the volume key, optional pre / post hooks in the workload, Kopia snapshot),
 * `restoreRun` (whole volume, a path, or a scratch restore with a check hook). The agent reports `backupProgress`
 * on the same channel; commands are idempotent per id (re-sent until reported).
 */

export const BACKUP_CHANNEL_PREFIX = 'backup:';

export function backupChannel(id: string): string {
  return `${BACKUP_CHANNEL_PREFIX}${id}`;
}

const ipAddress = z
  .string()
  .max(64)
  .refine((v) => isIp(v), 'invalid IP address');
const portSchema = z.number().int().min(1).max(65535);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
/** Derived passwords (32 bytes base64url). */
const derivedSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** `cluster` or `project-<project>`: one repository per trust boundary. */
export const backupScopeSchema = z.string().regex(/^(cluster|project-[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$/);
export type BackupScope = z.infer<typeof backupScopeSchema>;

export function projectBackupScope(project: string): string {
  return `project-${project}`;
}

/** Kopia user / host names (`user@host`): no `@`, no whitespace. */
export const kopiaNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,127}$/);

/** Kopia user of a volume: `v-<deployment>.<volume>@<project>`. */
export function volumeBackupUser(volumeId: string): { username: string; hostname: string } {
  const [project, deployment, volume] = volumeId.split('/');

  return { username: `v-${deployment}.${volume}`, hostname: project };
}

/** The control plane's Kopia identity in every repository (FULL access, maintenance owner). */
export const KOPIA_CONTROL_USER = { username: 'control-plane', hostname: 'loadweaver' } as const;

/** Snapshot source path of a volume inside the Kopia client container. */
export const VOLUME_SNAPSHOT_PATH = '/volume';

/** Kopia object id of a snapshot root (`k…`) or a snapshot manifest id. */
export const kopiaObjectIdSchema = z.string().regex(/^(k[0-9a-f]{32,128}|[0-9a-f]{32})$/);

/** Where and as whom a node reaches a repository. Credentials travel only in commands, never in desired state. */
export const kopiaRepositoryAccessSchema = z
  .object({
    scope: backupScopeSchema,
    /** Repository servers (members' overlay addresses), tried in order. */
    servers: z
      .array(z.object({ address: ipAddress, port: portSchema }).strict())
      .min(1)
      .max(7),
    /** SHA-256 of the servers' TLS certificate (DER), pinned by the client. */
    fingerprint: hex64,
    username: kopiaNameSchema,
    hostname: kopiaNameSchema,
    password: derivedSecret,
  })
  .strict();
export type KopiaRepositoryAccess = z.infer<typeof kopiaRepositoryAccessSchema>;

const command = z.array(z.string().max(1024)).min(1).max(64);

/** `x-loadweaver.backup.hooks`: commands run in a replica of the service before / after the snapshot. */
export const backupHooksSchema = z
  .object({
    replica: replicaIdSchema,
    pre: command.optional(),
    post: command.optional(),
    timeoutSeconds: z.number().int().min(1).max(3600),
  })
  .strict();
export type BackupHooks = z.infer<typeof backupHooksSchema>;

/**
 * Backup of a volume on the node holding its primary: pre hook → LVM thin snapshot of the LV under LUKS → post hook
 * → snapshot opened read-only with the volume key, mounted read-only → Kopia snapshot as the volume's user →
 * cleanup (always).
 */
export const backupRunSchema = z
  .object({
    backup: z.string().uuid(),
    volume: volumeIdSchema,
    repository: kopiaRepositoryAccessSchema,
    description: z.string().max(256),
    tags: z.record(z.string().regex(/^[a-z0-9_.-]{1,32}$/), z.string().max(128)),
    hooks: backupHooksSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v.tags).length <= 16, 'at most 16 tags');
export type BackupRun = z.infer<typeof backupRunSchema>;

/** Check hook of a restore test: a container of `image` with the scratch volume at `mountPath`; exit 0 = passed. */
export const restoreCheckSchema = z
  .object({
    image: z.string().max(512),
    command: command,
    mountPath: z
      .string()
      .max(512)
      .regex(/^\/[^\0]*$/),
    timeoutSeconds: z.number().int().min(1).max(3600),
  })
  .strict();
export type RestoreCheck = z.infer<typeof restoreCheckSchema>;

const relativePath = z
  .string()
  .max(4096)
  .refine((p) => !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === ''), 'relative path without ..');

/**
 * A restore on a node:
 * - `volume`: the whole snapshot into `volume` (primary here, workloads stopped by the plan); `replace` empties it
 *   first, `merge` only adds / overwrites files;
 * - `path`: one file or directory (`path` in the snapshot) into the volume at `targetPath` (default: same path),
 *   never overwriting unless `overwrite` (single-file restore from the file browser);
 * - `scratch`: restore test into a temporary LV (encrypted with a throw-away key, `sizeBytes`), then the optional
 *   check hook; everything is removed afterwards.
 */
export const restoreRunSchema = z
  .object({
    restore: z.string().uuid(),
    kind: z.enum(['volume', 'path', 'scratch']),
    /** Root object (`k…`) of the snapshot. */
    snapshot: kopiaObjectIdSchema,
    repository: kopiaRepositoryAccessSchema,
    /** Target volume (`volume`, `path`) or the backed-up volume (`scratch`, for naming). */
    volume: volumeIdSchema,
    mode: z.enum(['replace', 'merge']).optional(),
    path: relativePath.optional(),
    targetPath: relativePath.optional(),
    overwrite: z.boolean().optional(),
    sizeBytes: z.number().int().positive().optional(),
    check: restoreCheckSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'path' && !v.path)
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'path restore needs path' });

    if (v.kind === 'scratch' && !v.sizeBytes)
      ctx.addIssue({ code: 'custom', path: ['sizeBytes'], message: 'scratch restore needs sizeBytes' });
  });
export type RestoreRun = z.infer<typeof restoreRunSchema>;

export const BACKUP_PHASES = ['hooks', 'snapshot', 'upload', 'restore', 'check', 'cleanup'] as const;
export type BackupPhase = (typeof BACKUP_PHASES)[number];

/** Agent → control plane: progress / result of a `backupRun` or `restoreRun` (on its channel). */
export const backupProgressSchema = z
  .object({
    id: z.string().uuid(),
    operation: z.enum(['backup', 'restore']),
    status: z.enum(['running', 'done', 'failed']),
    phase: z.enum(BACKUP_PHASES).optional(),
    bytes: z.number().int().nonnegative().optional(),
    files: z.number().int().nonnegative().optional(),
    /** Bytes the upload actually added to the repository (after dedup / compression). */
    uploadedBytes: z.number().int().nonnegative().optional(),
    /** Backup done: the Kopia snapshot. */
    snapshot: z
      .object({
        manifestId: z.string().regex(/^[0-9a-f]{32}$/),
        rootObject: kopiaObjectIdSchema,
        startTime: z.string().datetime({ offset: true }),
        endTime: z.string().datetime({ offset: true }),
      })
      .strict()
      .optional(),
    /** Restore test: the check hook's result. */
    check: z
      .object({ exitCode: z.number().int().nullable(), output: z.string().max(8192) })
      .strict()
      .optional(),
    /** Hooks ran (and succeeded) for this backup. */
    hooks: z.boolean().optional(),
    error: z.string().max(4096).optional(),
  })
  .strict();
export type BackupProgress = z.infer<typeof backupProgressSchema>;

/**
 * A repository server a member runs (desired state `backupServer`, feature `backups`). Secrets (object-store key,
 * repository password, control user password, TLS key) are injected at push time only.
 */
export const backupRepositoryServerSchema = z
  .object({
    scope: backupScopeSchema,
    port: portSchema,
    s3: z
      .object({
        address: ipAddress,
        port: portSchema,
        bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
        /** `<scope>/` */
        prefix: z.string().regex(/^[a-z0-9-]{1,80}\/$/),
      })
      .strict(),
    tls: z
      .object({ certificatePem: z.string().max(16_384), privateKeyPem: z.string().max(16_384).optional() })
      .strict(),
    accessKeyId: z.string().max(128).optional(),
    secretAccessKey: z.string().max(128).optional(),
    password: derivedSecret.optional(),
    /** The control plane's Kopia user (FULL); created by the server's bootstrap. */
    controlPassword: derivedSecret.optional(),
    /** Basic-auth password of the server's control API (`kopia server refresh` after user changes). */
    serverControlPassword: derivedSecret.optional(),
  })
  .strict();
export type BackupRepositoryServer = z.infer<typeof backupRepositoryServerSchema>;

export const backupServerRoleSchema = z
  .object({ repositories: z.array(backupRepositoryServerSchema).max(256) })
  .strict();
export type BackupServerRole = z.infer<typeof backupServerRoleSchema>;

/** Ports of the repository servers on the members (one per repository). */
export const BACKUP_SERVER_PORTS = { from: 7500, to: 7755 } as const;

export type KopiaAccess = 'READ' | 'APPEND' | 'FULL';

/**
 * ACL of every repository (M6 spike): Kopia's default FULL entries for a user's own snapshots / user record are
 * replaced by APPEND / READ, so nodes can create, list and restore their own snapshots but can't delete them, change
 * the global / host policies, run maintenance or see other users' snapshots. Their own source policies stay FULL
 * (2026-10-27, see the rule); the control plane's user gets FULL.
 */
export const KOPIA_ACL_RULES: ReadonlyArray<{ user: string; access: KopiaAccess; target: string }> = [
  { user: '*@*', access: 'APPEND', target: 'type=content' },
  { user: '*@*', access: 'READ', target: 'type=policy,policyType=global' },
  { user: '*@*', access: 'READ', target: 'type=policy,hostname=OWN_HOST,policyType=host' },
  // FULL on the node's own source policies (user decision 2026-10-27): `kopia snapshot create --stdin-file` (VM disks,
  // block volumes) always rewrites its source's scheduling policy (`manual`), a delete + put. The control plane
  // re-asserts every source policy before each retention run and alerts on drift (`builtin:backup-policy-drift`).
  { user: '*@*', access: 'FULL', target: 'type=policy,hostname=OWN_HOST,username=OWN_USER' },
  { user: '*@*', access: 'APPEND', target: 'type=snapshot,hostname=OWN_HOST,username=OWN_USER' },
  { user: '*@*', access: 'READ', target: 'type=user,username=OWN_USER@OWN_HOST' },
  { user: `${KOPIA_CONTROL_USER.username}@${KOPIA_CONTROL_USER.hostname}`, access: 'FULL', target: 'type=snapshot' },
  { user: `${KOPIA_CONTROL_USER.username}@${KOPIA_CONTROL_USER.hostname}`, access: 'FULL', target: 'type=policy' },
  { user: `${KOPIA_CONTROL_USER.username}@${KOPIA_CONTROL_USER.hostname}`, access: 'FULL', target: 'type=content' },
  { user: `${KOPIA_CONTROL_USER.username}@${KOPIA_CONTROL_USER.hostname}`, access: 'FULL', target: 'type=user' },
];

/** Kopia's targets are `key=value` lists in any order; this compares them as sets. */
export function normalizeKopiaTarget(target: string): string {
  return target
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

export interface KopiaAclEntry {
  id: string;
  user: string;
  access: string;
  target: string;
}

/** Parses `kopia server acl list` lines (`id:<id> user:<u> access:<a> target:<t>`). */
export function parseKopiaAclList(output: string): KopiaAclEntry[] {
  const entries: KopiaAclEntry[] = [];

  for (const line of output.split('\n')) {
    const match = /^id:([0-9a-f]+)\s+user:(\S+)\s+access:(\S+)\s+target:(\S+)\s*$/.exec(line.trim());

    if (match) entries.push({ id: match[1], user: match[2], access: match[3], target: match[4] });
  }

  return entries;
}

/** What to delete / add so the repository's ACL equals `KOPIA_ACL_RULES` (idempotent reconcile). */
export function kopiaAclChanges(
  current: readonly KopiaAclEntry[],
  wanted: ReadonlyArray<{ user: string; access: KopiaAccess; target: string }> = KOPIA_ACL_RULES,
): { remove: string[]; add: Array<{ user: string; access: KopiaAccess; target: string }> } {
  const key = (e: { user: string; access: string; target: string }) =>
    `${e.user}|${e.access}|${normalizeKopiaTarget(e.target)}`;
  const wantedKeys = new Set(wanted.map(key));
  const currentKeys = new Set(current.map(key));

  return {
    remove: current.filter((e) => !wantedKeys.has(key(e))).map((e) => e.id),
    add: wanted.filter((e) => !currentKeys.has(key(e))),
  };
}

/**
 * Kopia user password hash (`kopia server user add --user-password-hash`): base64 of
 * `{"passwordHashVersion":1,"passwordHash":base64(salt ‖ scrypt(password, salt, N=65536, r=8, p=1, 32))}`, so no
 * password ever appears in a process's arguments. The salt is derived from the (random, 256-bit) password, which
 * makes the hash stable across pushes.
 */
export function kopiaPasswordHash(password: string): string {
  const salt = createHmac('sha256', 'loadweaver/kopia-user-salt').update(password).digest();
  const key = scryptSync(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });

  return Buffer.from(
    JSON.stringify({ passwordHashVersion: 1, passwordHash: Buffer.concat([salt, key]).toString('base64') }),
  ).toString('base64');
}

/** Kopia global policy of every repository: retention is decided by the control plane, never by clients. */
export const KOPIA_GLOBAL_POLICY_ARGS = [
  '--keep-latest',
  '1000000',
  '--keep-hourly',
  '0',
  '--keep-daily',
  '0',
  '--keep-weekly',
  '0',
  '--keep-monthly',
  '0',
  '--keep-annual',
  '0',
  '--compression',
  'zstd',
] as const;

/**
 * Shell script of a repository server container (`kopia/kopia` image, `/app` = state, `/tls` = certificate):
 * connect to (or create) the repository on the object store as the control plane's identity, reconcile the ACL
 * (`acl` = the rendered `kopia server acl …` commands), ensure the control plane's user and the global policy,
 * then serve over TLS. Secrets come from the environment only, never from arguments: `KOPIA_PASSWORD` (repository),
 * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (object store), `LW_CONTROL_PASSWORD_HASH`
 * (`kopiaPasswordHash` of the control user's password), `KOPIA_SERVER_CONTROL_PASSWORD` (control API).
 */
export function kopiaServerScript(server: Pick<BackupRepositoryServer, 'scope' | 'port' | 's3'>): string {
  const control = `${KOPIA_CONTROL_USER.username}@${KOPIA_CONTROL_USER.hostname}`;
  const storage = [
    's3',
    `--bucket=${server.s3.bucket}`,
    `--prefix=${server.s3.prefix}`,
    `--endpoint=${server.s3.address.includes(':') ? `[${server.s3.address}]` : server.s3.address}:${server.s3.port}`,
    '--disable-tls',
    '--region=garage',
  ].join(' ');
  const identity = `--override-username=${KOPIA_CONTROL_USER.username} --override-hostname=${KOPIA_CONTROL_USER.hostname}`;
  const wanted = KOPIA_ACL_RULES.map((r) => `${r.user}|${r.access}|${normalizeKopiaTarget(r.target)}`).join('\n');

  return [
    'set -eu',
    'export KOPIA_CHECK_FOR_UPDATES=false',
    `kopia repository connect ${storage} ${identity} >/dev/null 2>&1 || kopia repository create ${storage} ${identity}`,
    'kopia server acl enable >/dev/null 2>&1 || true',
    // ACL reconcile: drop entries that aren't wanted, add the missing ones.
    `WANTED='${wanted}'`,
    'kopia server acl list | while read -r id user access target; do',
    '  id=${id#id:}; user=${user#user:}; access=${access#access:}; target=${target#target:}',
    "  norm=$(printf '%s' \"$target\" | tr ',' '\\n' | sort | paste -sd, -)",
    '  printf \'%s\\n\' "$WANTED" | grep -qxF "$user|$access|$norm" || kopia server acl delete "$id" --delete',
    'done',
    'CURRENT=$(kopia server acl list | while read -r id user access target; do',
    '  user=${user#user:}; access=${access#access:}; target=${target#target:}',
    '  printf \'%s|%s|%s\\n\' "$user" "$access" "$(printf \'%s\' "$target" | tr \',\' \'\\n\' | sort | paste -sd, -)"',
    'done)',
    "printf '%s\\n' \"$WANTED\" | while IFS='|' read -r user access target; do",
    '  printf \'%s\\n\' "$CURRENT" | grep -qxF "$user|$access|$target" || kopia server acl add --user "$user" --access "$access" --target "$target"',
    'done',
    `kopia server user set ${control} --user-password-hash="$LW_CONTROL_PASSWORD_HASH" >/dev/null 2>&1 || kopia server user add ${control} --user-password-hash="$LW_CONTROL_PASSWORD_HASH"`,
    `kopia policy set --global ${KOPIA_GLOBAL_POLICY_ARGS.join(' ')} >/dev/null`,
    `exec kopia server start --address=https://0.0.0.0:${server.port} --tls-cert-file=/tls/tls.crt --tls-key-file=/tls/tls.key --no-ui`,
    '',
  ].join('\n');
}

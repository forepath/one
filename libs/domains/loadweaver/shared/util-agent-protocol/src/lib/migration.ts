import { z } from 'zod';

import { isIp } from '@forepath/loadweaver/shared/util-network';

import { replicaIdSchema, volumeIdSchema } from './live';

/**
 * Live migration sessions over the node stream (3.10, protocol v2, feature `live-migration`). The control plane
 * drives one session per migration attempt on the envelope channel `migration:<id>`; every command is idempotent
 * per (migration, attempt, message type) and may be sent again until the node reports the phase. Only nodes that
 * advertise `live-migration` ever receive these messages (`CONTROL_PLANE_MESSAGE_GATES`).
 *
 * Sequence (runc, CRIU pre-copy):
 *   target ← `migrationPrepare`  → target reports `prepare` done with its transfer endpoint
 *   source ← `migrationPrecopy`  → pre-dump rounds streamed to the target, `precopy` done when converged
 *   source ← `migrationFreeze`   → final dump (tasks left stopped, never killed), volumes demoted, `freeze` done,
 *                                  then the dump is streamed: `transfer` running / done
 *   target ← `migrationRestore`  → volumes promoted, restored with the kept addresses, `restore` done
 *   both   ← `migrationCommit`   → source deletes the frozen container and the checkpoint, target closes the endpoint
 * gVisor (`runsc`) skips the pre-copy: `runsc checkpoint` is the freeze (stop-and-copy).
 * On any failure or timeout: target ← `migrationAbort` (discard), then source ← `migrationAbort` (re-promote the
 * volumes, resume the stopped tasks); the control plane continues with the short-stop / blue-green path.
 */

/** Envelope channel of a migration session. */
export const MIGRATION_CHANNEL_PREFIX = 'migration:';

export function migrationChannel(migrationId: string): string {
  return `${MIGRATION_CHANNEL_PREFIX}${migrationId}`;
}

const nodeName = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
const migrationIdSchema = z.string().uuid();
const attemptSchema = z.number().int().min(1).max(100);
const ipAddress = z
  .string()
  .max(64)
  .refine((v) => isIp(v), 'invalid IP address');

/**
 * Single-use transfer token (32 random bytes, base64url): the source presents it to the target's transfer endpoint
 * in addition to its node certificate (mTLS over WireGuard); valid for one attempt, closed with the endpoint.
 */
export const transferTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** How the replica is checkpointed: CRIU through runc (live, with pre-copy) or gVisor's own (stop-and-copy). */
export const checkpointRuntimeSchema = z.enum(['runc', 'runsc']);
export type CheckpointRuntime = z.infer<typeof checkpointRuntimeSchema>;

/** The target's transfer endpoint on its overlay address. */
export const transferEndpointSchema = z
  .object({ address: ipAddress, port: z.number().int().min(1).max(65535) })
  .strict();
export type TransferEndpoint = z.infer<typeof transferEndpointSchema>;

const sessionFields = {
  migration: migrationIdSchema,
  attempt: attemptSchema,
  replica: replicaIdSchema,
};

/**
 * To the target: open a transfer endpoint for this attempt and prepare the replica without starting it (pull the
 * image, prepare volumes / secrets / the agent-managed runc bundle). `spec` (added in `messages.ts`) is what the
 * replica runs; `addresses` are kept from the source (cluster pod supernet, assigned by the node's IPAM plugin).
 */
export const migrationPrepareBaseSchema = z
  .object({
    ...sessionFields,
    source: nodeName,
    runtime: checkpointRuntimeSchema,
    token: transferTokenSchema,
    addresses: z.array(ipAddress).min(1).max(2),
    /** The endpoint closes when unused for this long. */
    expiresInSeconds: z.number().int().min(10).max(3600),
  })
  .strict();

/** To the source: iterative pre-dumps (CRIU `pre-dump` with dirty-page tracking) streamed to the target. */
export const migrationPrecopySchema = z
  .object({
    ...sessionFields,
    target: nodeName,
    endpoint: transferEndpointSchema,
    token: transferTokenSchema,
    maxRounds: z.number().int().min(1).max(30),
    /** Converged once a round's dirty memory is below this many bytes. */
    convergeBytes: z.number().int().nonnegative(),
  })
  .strict();
export type MigrationPrecopy = z.infer<typeof migrationPrecopySchema>;

/**
 * To the source: final dump (runc: `--leave-stopped` on top of the last pre-dump; runsc: `runsc checkpoint`) and
 * transfer, incl. the writable layer (upperdir tar). Volumes are flushed and demoted after the dump. If the freeze
 * would exceed `freezeBudgetMs`, the source resumes and reports `failed`.
 */
export const migrationFreezeSchema = z
  .object({
    ...sessionFields,
    target: nodeName,
    endpoint: transferEndpointSchema,
    token: transferTokenSchema,
    runtime: checkpointRuntimeSchema,
    volumes: z.array(volumeIdSchema).max(32),
    freezeBudgetMs: z.number().int().min(100).max(600_000),
  })
  .strict();
export type MigrationFreeze = z.infer<typeof migrationFreezeSchema>;

/**
 * To the target: promote the volumes, restore with the kept addresses (runc: fresh bundle and runc root,
 * `--tcp-established --manage-cgroups-mode=soft`) and run the replica as an agent-managed container until its next
 * restart (then it goes back to Docker).
 */
export const migrationRestoreSchema = z
  .object({
    ...sessionFields,
    runtime: checkpointRuntimeSchema,
    volumes: z.array(volumeIdSchema).max(32),
    addresses: z.array(ipAddress).min(1).max(2),
  })
  .strict();
export type MigrationRestore = z.infer<typeof migrationRestoreSchema>;

/** To both nodes after the cut-over: the source deletes the stopped container and the checkpoint data. */
export const migrationCommitSchema = z.object({ ...sessionFields, role: z.enum(['source', 'target']) }).strict();
export type MigrationCommit = z.infer<typeof migrationCommitSchema>;

/**
 * Ends a failed attempt. Target: kill / discard whatever was restored, demote the volumes, close the endpoint.
 * Source (only after the target confirmed, or never restored): promote `volumes` again and resume the stopped tasks.
 */
export const migrationAbortSchema = z
  .object({
    ...sessionFields,
    role: z.enum(['source', 'target']),
    reason: z.string().max(1024),
    volumes: z.array(volumeIdSchema).max(32),
  })
  .strict();
export type MigrationAbort = z.infer<typeof migrationAbortSchema>;

/** Phases a node reports; `commit` / `abort` confirm the respective command. */
export const MIGRATION_REPORT_PHASES = [
  'prepare',
  'precopy',
  'freeze',
  'transfer',
  'restore',
  'commit',
  'abort',
] as const;
export type MigrationReportPhase = (typeof MIGRATION_REPORT_PHASES)[number];

/** Agent → control plane: progress of a session (sent on the session's channel). */
export const migrationProgressSchema = z
  .object({
    ...sessionFields,
    phase: z.enum(MIGRATION_REPORT_PHASES),
    status: z.enum(['running', 'done', 'failed']),
    /** Pre-copy round (1-based). */
    round: z.number().int().min(0).max(1000).optional(),
    /** Bytes of this round / dump. */
    bytes: z.number().int().nonnegative().optional(),
    /** Checkpoint bytes transferred so far in this attempt. */
    totalBytes: z.number().int().nonnegative().optional(),
    /** Memory dirtied per second during the last round. */
    dirtyBytesPerSecond: z.number().int().nonnegative().optional(),
    /** Measured freeze (final dump → resumed on the target, as far as this node can see it). */
    freezeMs: z.number().int().nonnegative().optional(),
    /** `prepare` done: where the target listens. */
    endpoint: transferEndpointSchema.optional(),
    /** `abort` done on the source: whether the replica runs again. */
    resumed: z.boolean().optional(),
    error: z.string().max(2048).optional(),
  })
  .strict();
export type MigrationProgress = z.infer<typeof migrationProgressSchema>;

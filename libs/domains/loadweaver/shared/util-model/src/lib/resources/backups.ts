import { z } from 'zod';

import { resourceNameSchema } from '../metadata';
import { selectorSchema } from '../selector';
import { secretRefSchema } from './edge';

/**
 * Backups (3.20). Schedules and retention are policies with selectors that go through plan / apply; targets are
 * where copies live (the cluster's own object store is always the primary target); restores are resources too, so
 * creating one is a plan (approvals apply).
 */

const cron = z
  .string()
  .regex(/^(@(yearly|monthly|weekly|daily|hourly)|(\S+\s+){4}\S+)$/, 'invalid cron schedule')
  .max(128);

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });

    return true;
  } catch {
    return false;
  }
}

/**
 * Retention (restic / Kopia semantics): a snapshot is kept if any rule keeps it — the newest `keepLast`, the newest
 * per hour / day / week (ISO) / month / year for the given number of periods. At least one snapshot is always kept.
 */
export const backupRetentionSchema = z
  .object({
    keepLast: z.number().int().min(0).max(10_000).default(1),
    hourly: z.number().int().min(0).max(10_000).default(0),
    daily: z.number().int().min(0).max(10_000).default(0),
    weekly: z.number().int().min(0).max(10_000).default(0),
    monthly: z.number().int().min(0).max(10_000).default(0),
    yearly: z.number().int().min(0).max(1_000).default(0),
  })
  .strict();
export type BackupRetention = z.infer<typeof backupRetentionSchema>;

export const BACKUP_RETENTION_RULES = ['keepLast', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const;

/**
 * What a policy backs up: volumes of deployments, selected by project (the policy's own project for project
 * policies), deployment names / labels and volume names. Empty = every volume in scope.
 */
export const backupSelectorSchema = z
  .object({
    projects: z.array(resourceNameSchema).max(256).optional(),
    deployments: selectorSchema.optional(),
    volumes: z
      .array(z.string().regex(/^[a-z0-9_.-]{1,63}$/))
      .max(256)
      .optional(),
  })
  .strict();
export type BackupSelector = z.infer<typeof backupSelectorSchema>;

export const backupPolicySpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    selector: backupSelectorSchema.default({}),
    /** Cron schedules (several = e.g. hourly + nightly); missed runs aren't replayed one by one. */
    schedules: z.array(cron).min(1).max(8),
    timeZone: z.string().max(64).refine(validTimeZone, 'unknown time zone').default('UTC'),
    retention: backupRetentionSchema.default({
      keepLast: 1,
      hourly: 0,
      daily: 0,
      weekly: 0,
      monthly: 0,
      yearly: 0,
    }),
    /** External targets (`BackupTarget` names) that get a secondary copy after each backup. */
    targets: z.array(resourceNameSchema).max(8).default([]),
    /** Run the services' `x-loadweaver.backup.hooks` around the snapshot (app-consistent dumps). */
    hooks: z.boolean().default(true),
    /** Automated restore tests: scratch restore of the newest backup + the service's check hook. */
    restoreTest: z.object({ schedule: cron }).strict().optional(),
  })
  .strict();
export type BackupPolicySpec = z.infer<typeof backupPolicySpecSchema>;

const s3Endpoint = z
  .string()
  .max(512)
  .regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/?$/, 'endpoint must be a plain http(s) URL');

/**
 * A backup target outside the cluster (secondary copies; the cluster's own object store is the implicit default
 * `garage` target and can't be declared). External S3 targets should have S3 Object Lock in compliance mode with a
 * default retention on the bucket (Loadweaver checks it); SFTP needs all host-key types in `knownHosts`.
 */
export const backupTargetSpecSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('s3'),
      description: z.string().max(1024).optional(),
      endpoint: s3Endpoint,
      bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
      region: z.string().max(64).default('us-east-1'),
      prefix: z
        .string()
        .regex(/^([A-Za-z0-9._-]+\/)*$/, 'prefix ends with / (or is empty)')
        .max(256)
        .default(''),
      /** JSON `{ accessKeyId, secretAccessKey }`; write / append-only credentials where the provider allows it. */
      credentials: secretRefSchema,
      objectLock: z
        .object({
          mode: z.enum(['COMPLIANCE', 'GOVERNANCE']).default('COMPLIANCE'),
          days: z.number().int().min(1).max(36_500),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('sftp'),
      description: z.string().max(1024).optional(),
      host: z
        .string()
        .max(253)
        .regex(/^[A-Za-z0-9.-]+$/),
      port: z.number().int().min(1).max(65535).default(22),
      user: z
        .string()
        .max(64)
        .regex(/^[A-Za-z0-9._-]+$/),
      path: z
        .string()
        .max(1024)
        .regex(/^\/[^\0]*$/),
      /** The private key (OpenSSH format). */
      keySecret: secretRefSchema,
      /** `known_hosts` lines of the server — all of its host-key types. */
      knownHosts: z.string().min(10).max(16_384),
    })
    .strict(),
]);
export type BackupTargetSpec = z.infer<typeof backupTargetSpecSchema>;

const volumeName = z.string().regex(/^[a-z0-9_.-]{1,63}$/);
const relativePath = z
  .string()
  .max(4096)
  .refine((p) => !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === ''), 'relative path without ..');

/**
 * A restore (3.20), created through a plan (approvals apply) and executed once per generation: the whole backup
 * into a volume of the project (an existing one: `replace` / `merge`; a new, empty one next to it: side by side) or
 * one path into the volume (single-file restore).
 */
export const restoreSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    /** Backup id from the catalog. */
    backup: z.string().uuid(),
    target: z
      .object({
        deployment: resourceNameSchema,
        volume: volumeName,
        mode: z.enum(['replace', 'merge']).default('replace'),
        /** Only this file / directory of the backup (single-file restore). */
        path: relativePath.optional(),
        /** Where `path` goes in the volume (default: the same path). */
        targetPath: relativePath.optional(),
        overwrite: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();
export type RestoreSpec = z.infer<typeof restoreSpecSchema>;

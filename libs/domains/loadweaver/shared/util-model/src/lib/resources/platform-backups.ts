import { z } from 'zod';

import { resourceNameSchema } from '../metadata';

/**
 * Backups of the control plane's own data (3.20), `Cluster.spec.backups.platform`: Postgres + TimescaleDB (WAL-G
 * base backups + continuous WAL archive → point-in-time recovery), OpenSearch snapshots, etcd snapshots. Schedules
 * are five-field cron expressions in `timeZone`; retention keeps the newest `keep` backups of each kind (for
 * Postgres the recovery window starts at the oldest kept base backup). Changes go through plan / apply.
 */

/** Five cron fields (or a macro); fully validated by the scheduler's parser at use. */
const cronExpression = z
  .string()
  .max(120)
  .regex(/^(@(yearly|annually|monthly|weekly|daily|midnight|hourly)|(\S+\s+){4}\S+)$/, 'invalid cron expression');

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });

    return true;
  } catch {
    return false;
  }
}

const kind = (schedule: string, keep: number) =>
  z
    .object({
      enabled: z.boolean().default(true),
      schedule: cronExpression.default(schedule),
      keep: z.number().int().min(1).max(1000).default(keep),
    })
    .strict()
    .default({ enabled: true, schedule, keep });

export const PLATFORM_BACKUP_DEFAULTS = {
  postgres: { schedule: '0 2 * * *', keep: 7 },
  opensearch: { schedule: '30 2 * * *', keep: 14 },
  etcd: { schedule: '15 * * * *', keep: 48 },
} as const;

export const clusterPlatformBackupsSchema = z
  .object({
    enabled: z.boolean().default(true),
    timeZone: z.string().max(64).refine(validTimeZone, 'unknown time zone').default('UTC'),
    /** WAL-G base backups (WAL is archived continuously in between). */
    postgres: kind(PLATFORM_BACKUP_DEFAULTS.postgres.schedule, PLATFORM_BACKUP_DEFAULTS.postgres.keep),
    /** Snapshots of the log store (logs, audit mirror). */
    opensearch: kind(PLATFORM_BACKUP_DEFAULTS.opensearch.schedule, PLATFORM_BACKUP_DEFAULTS.opensearch.keep),
    etcd: kind(PLATFORM_BACKUP_DEFAULTS.etcd.schedule, PLATFORM_BACKUP_DEFAULTS.etcd.keep),
    /**
     * External `BackupTarget`s that receive an encrypted copy of the platform backups (WAL archive, base backups,
     * OpenSearch / etcd snapshots, DR envelopes), so the control plane survives the loss of the cluster (3.20).
     * Absent: every declared `BackupTarget`; `[]`: none (the cluster shows a pin).
     */
    targets: z.array(resourceNameSchema).max(8).optional(),
  })
  .strict();
export type ClusterPlatformBackups = z.infer<typeof clusterPlatformBackupsSchema>;

export const clusterBackupsSchema = z
  .object({
    platform: clusterPlatformBackupsSchema.optional(),
  })
  .strict();
export type ClusterBackups = z.infer<typeof clusterBackupsSchema>;

/** The effective platform-backup settings of a cluster spec (defaults when the section is absent). */
export function platformBackupSettings(backups: ClusterBackups | undefined): ClusterPlatformBackups {
  return clusterPlatformBackupsSchema.parse(backups?.platform ?? {});
}

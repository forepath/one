import type { DataSource, EntityManager } from 'typeorm';

/**
 * Stored backup bytes per project (live backups, after dedup / compression): counted against the project's storage
 * quota (3.17 / 3.20). Missing table (older schema) = no backup usage.
 */
export async function backupBytesByProject(db: DataSource | EntityManager): Promise<Map<string, number>> {
  const rows = (await db
    .query(
      `SELECT project, COALESCE(SUM(uploaded_bytes), 0) AS bytes FROM lw_backups
       WHERE project IS NOT NULL AND deleted_at IS NULL AND status = 'succeeded' GROUP BY project`,
    )
    .catch(() => [])) as Array<{ project: string; bytes: string }>;

  return new Map(rows.map((r) => [r.project, Number(r.bytes)]));
}

export interface BackupReportSection {
  backups: number;
  failedBackups: number;
  /** Logical bytes backed up, and what the uploads added to the repositories (dedup / compression). */
  bytes: number;
  uploadedBytes: number;
  restoreTests: number;
  failedRestoreTests: number;
}

/** Backups and restore tests of a project (or the whole cluster) in a period, for the monthly report (3.25). */
export async function backupReportSection(
  db: DataSource | EntityManager,
  project: string | null,
  from: Date,
  to: Date,
): Promise<BackupReportSection> {
  const where = project ? 'project = $3' : 'TRUE';
  const params = project ? [from, to, project] : [from, to];
  const [backups] = (await db.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(uploaded_bytes), 0) AS uploaded
     FROM lw_backups WHERE started_at >= $1 AND started_at < $2 AND ${where}`,
    params,
  )) as Array<{ total: string; failed: string; bytes: string; uploaded: string }>;
  const [tests] = (await db.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM lw_restore_tests WHERE started_at >= $1 AND started_at < $2 AND ${where}`,
    params,
  )) as Array<{ total: string; failed: string }>;

  return {
    backups: Number(backups?.total ?? 0),
    failedBackups: Number(backups?.failed ?? 0),
    bytes: Number(backups?.bytes ?? 0),
    uploadedBytes: Number(backups?.uploaded ?? 0),
    restoreTests: Number(tests?.total ?? 0),
    failedRestoreTests: Number(tests?.failed ?? 0),
  };
}

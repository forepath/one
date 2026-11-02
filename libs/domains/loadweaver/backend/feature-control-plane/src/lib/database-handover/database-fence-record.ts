import type { Heartbeat } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { AuditLogService } from '../services/audit-log.service';
import { parseFenceRecords, withFenceRecord, type DatabaseFenceRecord } from './database-handover.utils';
import { databaseTarget, type DatabaseTargetRuntime } from './database-target.runtime';

/** Reports already recorded by this process (node@at): agents repeat their last report in every heartbeat. */
const recorded = new Set<string>();

/** Tests. */
export function resetRecordedFences(): void {
  recorded.clear();
}

/**
 * Records a fenced member's report (heartbeat `databaseFence`, 3.43 takeover) once: into the handover row's `fences`
 * (the overview's inbox shows it for a week) and the audit log (`control-plane.database-fenced`: where the old data
 * went, the export of the rows written there after the takeover; never merged). Skipped while the database can't take
 * writes (read-only / frozen); the agent repeats the report.
 */
export async function recordDatabaseFence(
  dataSource: { query(text: string, params?: unknown[]): Promise<unknown> },
  audit: Pick<AuditLogService, 'recordStandalone'>,
  node: string,
  report: NonNullable<Heartbeat['databaseFence']>,
  runtime: Pick<DatabaseTargetRuntime, 'fallback' | 'freeze'> = databaseTarget,
): Promise<boolean> {
  const key = `${node}@${report.at}`;

  if (recorded.has(key) || runtime.fallback || runtime.freeze) return false;

  const rows = (await dataSource.query(
    `SELECT to_jsonb(h)->'fences' AS fences FROM "lw_database_handover" h WHERE h."id" = 'cluster'`,
  )) as { fences: unknown }[];

  // No row: a cluster that never had an external control plane (on-node installs): nothing to keep it in.
  if (!rows.length) {
    recorded.add(key);

    return false;
  }

  const record: DatabaseFenceRecord = { node, ...report };
  const next = withFenceRecord(parseFenceRecords(rows[0].fences), record);

  recorded.add(key);

  if (!next) return false;

  await dataSource.query(`UPDATE "lw_database_handover" SET "fences" = $1::jsonb WHERE "id" = 'cluster'`, [
    JSON.stringify(next),
  ]);
  await audit.recordStandalone({
    actor: { type: 'system' },
    action: 'control-plane.database-fenced',
    target: `nodes/${node}`,
    details: { ...report },
  });

  return true;
}

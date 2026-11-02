import type { EntityManager } from 'typeorm';

import type { JoinPlan } from '@forepath/loadweaver/shared/util-import';

/**
 * Deployments a join plan imports and hasn't released yet (3.21): their replicas are placed (volumes are created on
 * the node, so the data can be copied in) but they don't run and get no ingress routes until the release step —
 * the source still runs on the host and holds the ports.
 */
export async function heldImportDeployments(manager: EntityManager): Promise<Set<string>> {
  const rows: { join_plan: JoinPlan; released: string[] }[] = await manager.query(
    `SELECT join_plan, released FROM lw_import_selections WHERE status IN ('planned', 'running', 'failed', 'rolled-back')`,
  );

  const held = new Set<string>();

  for (const row of rows) {
    const released = new Set(row.released ?? []);

    for (const d of row.join_plan?.deployments ?? [])
      if (!released.has(`${d.project}/${d.name}`)) held.add(`${d.project}/${d.name}`);
  }

  return held;
}

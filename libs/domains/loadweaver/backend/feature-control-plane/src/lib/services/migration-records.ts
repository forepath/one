import { randomBytes, randomUUID } from 'node:crypto';

import type { WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { EntityManager } from 'typeorm';

import { MigrationEntity } from '../entities/migration.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import type { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { sessionMetrics, type SessionReports } from '../utils/migration-state.utils';

/**
 * Migration history and session records (3.10), written inside the transaction of the change they belong to.
 */

const CHECKPOINT = new Set(['live', 'stop-and-copy']);

export function isCheckpointMethod(method: string | undefined): method is 'live' | 'stop-and-copy' {
  return !!method && CHECKPOINT.has(method);
}

/** The spec the source runs now (its last compiled desired state): what the target prepares for a checkpoint. */
export async function runningSpec(manager: EntityManager, node: string, replica: string): Promise<WorkloadSpec | null> {
  const state = await manager.getRepository(NodeDesiredStateEntity).findOne({ where: { nodeName: node } });
  const workloads = (state?.state['workloads'] as WorkloadSpec[] | undefined) ?? [];

  return workloads.find((w) => w.id === replica) ?? null;
}

/** A timeline event (3.18) in the change's transaction. */
export async function migrationEvent(
  manager: EntityManager,
  replica: string,
  project: string,
  message: string,
  data: Record<string, unknown>,
): Promise<void> {
  await manager.query(`INSERT INTO lw_events (kind, entity, project, message, data) VALUES ($1, $2, $3, $4, $5)`, [
    'migration',
    replica.slice(0, 255),
    project,
    message.slice(0, 4000),
    JSON.stringify(data),
  ]);
}

/**
 * Starts the next attempt of a placement's migration: a history row, and for checkpoint methods the session
 * (phase `prepare`, a fresh single-use transfer token, the kept addresses and the spec the source runs).
 * Updates `placement.migration` in place (id, attempt, first phase); the caller saves the placement.
 */
export async function beginAttempt(
  manager: EntityManager,
  placement: WorkloadPlacementEntity,
  options: { volumes: string[]; spec: WorkloadSpec | null; now: Date },
): Promise<MigrationEntity> {
  const migration = placement.migration;

  if (!migration || !placement.targetNode) throw new Error(`placement ${placement.id} is not migrating`);

  const checkpoint = isCheckpointMethod(migration.method);
  const attempt = (migration.attempt ?? 0) + 1;
  const row = manager.getRepository(MigrationEntity).create({
    id: randomUUID(),
    replica: placement.id,
    project: placement.project,
    deployment: placement.deployment,
    fromNode: placement.node,
    toNode: placement.targetNode,
    method: migration.method,
    attempt,
    phase: checkpoint ? 'prepare' : migration.method === 'blue-green' ? 'starting' : 'stopping',
    reason: migration.reason,
    methodLabel: (migration.label ?? migration.method).slice(0, 512),
    fallbackReason: null,
    freezeMs: null,
    checkpointBytes: null,
    precopyRounds: null,
    runtime: checkpoint ? (migration.runtime ?? 'runc') : null,
    addresses: checkpoint ? placement.addresses : placement.targetAddresses,
    volumes: checkpoint ? options.volumes : [],
    spec: checkpoint ? (options.spec as unknown as Record<string, unknown>) : null,
    token: checkpoint ? randomBytes(32).toString('base64url') : null,
    reports: {},
    restoreSent: false,
    phaseStartedAt: options.now,
    startedAt: options.now,
    finishedAt: null,
  });

  await manager.getRepository(MigrationEntity).insert(row);
  placement.migration = {
    ...migration,
    id: row.id,
    attempt,
    phase: row.phase as NonNullable<WorkloadPlacementEntity['migration']>['phase'],
    startedAt: options.now.toISOString(),
    after: undefined,
  };
  await migrationEvent(
    manager,
    placement.id,
    placement.project,
    `${placement.id}: ${row.methodLabel} migration ${placement.node} → ${placement.targetNode} started (attempt ${attempt})`,
    { migration: row.id, method: row.method, from: row.fromNode, to: row.toNode, attempt },
  );

  return row;
}

/** Moves a checkpoint attempt to its next phase. */
export async function setPhase(
  manager: EntityManager,
  id: string,
  phase: string,
  now: Date,
  extra: Partial<Pick<MigrationEntity, 'restoreSent' | 'fallbackReason'>> = {},
): Promise<void> {
  await manager.getRepository(MigrationEntity).update({ id }, { phase, phaseStartedAt: now, ...extra });
}

/** Ends an attempt with its measurements. */
export async function finishAttempt(
  manager: EntityManager,
  id: string | undefined,
  phase: 'done' | 'failed' | 'fallback' | 'cancelled',
  now: Date,
  extra: { fallbackReason?: string; reports?: SessionReports } = {},
): Promise<void> {
  if (!id) return;

  const metrics = extra.reports ? sessionMetrics(extra.reports) : null;

  await manager.getRepository(MigrationEntity).update(
    { id },
    {
      phase,
      phaseStartedAt: now,
      finishedAt: now,
      ...(extra.fallbackReason ? { fallbackReason: extra.fallbackReason.slice(0, 2048) } : {}),
      ...(metrics
        ? {
            freezeMs: metrics.freezeMs,
            checkpointBytes: metrics.checkpointBytes === null ? null : String(metrics.checkpointBytes),
            precopyRounds: metrics.precopyRounds,
          }
        : {}),
      // The token is single-use: gone with the attempt.
      token: null,
    },
  );
}

import type { CronSpec } from '@forepath/loadweaver/shared/util-compose';
import { eligibleNodes, type SchedulerNode, type SchedulerService } from '@forepath/loadweaver/shared/util-scheduler';

import type { CronRunState } from '../entities/cron-run.entity';
import { serviceId, toSchedulerService, type ParsedDeployment } from './workload-planning.utils';

export interface CronDefinition {
  /** `project/deployment/service` */
  id: string;
  project: string;
  deployment: string;
  service: string;
  cron: CronSpec;
  scheduler: SchedulerService;
}

/** Cron jobs of all deployments (3.23). */
export function cronDefinitions(parsed: readonly ParsedDeployment[]): CronDefinition[] {
  return parsed.flatMap((d) =>
    d.compose.services
      .filter((s) => s.kind === 'cron' && s.cron)
      .map((s) => ({
        id: serviceId(d.project, d.name, s.name),
        project: d.project,
        deployment: d.name,
        service: s.name,
        cron: s.cron as CronSpec,
        scheduler: toSchedulerService(d, s),
      })),
  );
}

/**
 * Where a run goes: an eligible node (lifecycle, runtime, selector), on the primary of its replicated volumes
 * (data locality, 3.5), with the fewest workloads; ties by name so retries of the same state are stable.
 */
export function pickCronNode(
  service: SchedulerService,
  nodes: readonly SchedulerNode[],
  workloadsPerNode: ReadonlyMap<string, number>,
  volumePrimaries: ReadonlyMap<string, string>,
): { node: string } | { error: string } {
  let candidates = eligibleNodes(service, nodes);

  for (const volume of service.volumes) {
    const primary = volumePrimaries.get(volume.id);

    if (!primary) return { error: `volume ${volume.id} has no placement yet; a service of the deployment must use it` };

    candidates = candidates.filter((n) => n.name === primary);
  }

  const best = [...candidates].sort(
    (a, b) => (workloadsPerNode.get(a.name) ?? 0) - (workloadsPerNode.get(b.name) ?? 0) || a.name.localeCompare(b.name),
  )[0];

  return best ? { node: best.name } : { error: 'no eligible node can run the job' };
}

export interface CronRunProgress {
  startedAt: Date;
  node: string;
  timeoutSeconds: number;
  /** The agent's last report for the run's container. */
  status?: { state: string; exitCode?: number; message?: string; at: string };
  nodeReachable: boolean;
}

/** Whether a running run finished; null = still running. */
export function cronRunOutcome(
  run: CronRunProgress,
  now: number,
): { state: CronRunState; exitCode?: number; message?: string } | null {
  // Every run has its own placement row that starts without a status, so any report belongs to this run; the
  // node's clock (status.at) is not compared with the control plane's.
  const fresh = run.status;

  if (fresh?.state === 'exited') return { state: 'succeeded', exitCode: fresh.exitCode ?? 0 };

  if (fresh?.state === 'failed')
    return {
      state: 'failed',
      ...(fresh.exitCode !== undefined ? { exitCode: fresh.exitCode } : {}),
      ...(fresh.message ? { message: fresh.message } : {}),
    };

  if (now - run.startedAt.getTime() > run.timeoutSeconds * 1000)
    return { state: 'timed-out', message: `no result after ${run.timeoutSeconds}s` };

  if (!run.nodeReachable) return { state: 'node-lost', message: `node ${run.node} is unreachable` };

  return null;
}

/** States a retry follows (3.23); cancelled and skipped runs are never retried. */
export const RETRYABLE_CRON_STATES: ReadonlySet<CronRunState> = new Set(['failed', 'timed-out', 'node-lost']);

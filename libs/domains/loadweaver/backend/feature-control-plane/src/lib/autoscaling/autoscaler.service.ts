import type { RequestWithUser } from '@forepath/identity/backend';
import type { ServiceSpec } from '@forepath/loadweaver/shared/util-compose';
import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';
import type { ReplicaPlacement } from '@forepath/loadweaver/shared/util-scheduler';
import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';

import { canReadProject } from '../access/access.utils';
import { projectUsage, type ProjectUsage } from '../access/plan-access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { backupBytesByProject } from '../backups/backup-usage';
import { ADVISORY_LOCK_PLACEMENT_ALLOCATION } from '../constants/control-plane.constants';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { WorkloadPlacementEntity } from '../entities/workload-placement.entity';
import { hostPattern } from '../health/slo.utils';
import { AuditLogService } from '../services/audit-log.service';
import { NetworkStateService } from '../services/network-state.service';
import { plannerNodes, WorkloadPlannerService } from '../services/workload-planner.service';
import { drainDeadline, isDraining } from '../utils/replica-drain.utils';
import { serviceId, toSchedulerNodes, toSchedulerServices } from '../utils/workload-planning.utils';
import { unfoldableEgressServices, withEgressFeatureRequirements } from '../utils/egress-steering.utils';
import { AutoscaleStateEntity, type AutoscaleStatus } from './autoscale-state.entity';
import {
  average,
  combineHostValues,
  DEFAULT_AUTOSCALE_TIMING,
  describeMetric,
  largestAllowed,
  metricName,
  placeScaleUp,
  quotaBlock,
  recommend,
  replicasToRemove,
  type AutoscaledService,
  type AutoscaleTiming,
  type CapacityInput,
} from './autoscale.utils';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 15_000;
const ADVISORY_LOCK_AUTOSCALER = 0x4c570040;
/** Metric samples come every 10 s: the value is the average of the last minute. */
const METRIC_WINDOW_MS = 60_000;

export interface AutoscalingDto {
  /** `project/deployment/service` */
  id: string;
  project: string;
  deployment: string;
  service: string;
  min: number;
  max: number;
  metric: 'cpu' | 'memory' | 'requests' | 'custom';
  customMetric: string | null;
  target: number;
  /** Replicas placed now. */
  replicas: number;
  /** The count the planner uses (the autoscaler's last decision). */
  desiredReplicas: number;
  /** Current value and the last evaluation (null before the first one). */
  status: AutoscaleStatus | null;
  lastScaleAt: string | null;
  lastReason: string | null;
  lastValue: number | null;
}

/** One scaling action of a tick. */
export interface AutoscaleAction {
  service: string;
  from: number;
  to: number;
  reason: string;
}

interface MetricReading {
  value: number | null;
  missing?: string;
}

/**
 * Horizontal autoscaling (3.23), leader-elected across control-plane replicas (advisory lock per tick, every
 * 15 s): reads each autoscaled service's metric, computes the HPA recommendation, and scales automatically — not
 * through plans — within min..max, the project quota, the cluster capacity and the N+1 reserve. New replicas are
 * placed by the scheduler next to what runs; scale-down removes the newest replicas, which stop through the normal
 * stop path. Every action is audited (`workload.autoscaled`) and recorded as an `autoscale` event.
 */
@Injectable()
export class AutoscalerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AutoscalerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Tolerance, windows and cooldowns; tests shorten them. */
  timing: AutoscaleTiming = DEFAULT_AUTOSCALE_TIMING;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly planner: WorkloadPlannerService,
    private readonly network: NetworkStateService,
    private readonly audit: AuditLogService,
    private readonly access: ProjectAccessService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_AUTOSCALER ?? process.env.LOADWEAVER_WORKLOAD_CONTROLLER ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('Autoscaler', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Autoscaler: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One evaluation of every autoscaled service; returns the scaling actions taken. */
  async tick(now = Date.now()): Promise<AutoscaleAction[]> {
    const backupBytes = await backupBytesByProject(this.dataSource);
    const actions = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_AUTOSCALER,
      ]);

      if (!locked) return [];

      const resources = await manager.getRepository(ResourceEntity).find();
      const { parsed, autoscaled } = await this.planner.parseAutoscaled(manager, resources);
      const stateRepo = manager.getRepository(AutoscaleStateEntity);
      const states = new Map((await stateRepo.find()).map((s) => [s.serviceKey, s]));
      const wanted = new Set(autoscaled.map((a) => a.id));

      // Autoscaling switched off or the service removed: its state goes (the compose `replicas` count again).
      for (const key of [...states.keys()].filter((k) => !wanted.has(k))) {
        await stateRepo.delete({ serviceKey: key });
        states.delete(key);
      }

      if (autoscaled.length === 0) return [];

      // Placements change one writer at a time (plans, failover, drains, cron runs and this controller).
      await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_PLACEMENT_ALLOCATION]);

      const placements = await manager
        .getRepository(WorkloadPlacementEntity)
        .find({ where: { cronRun: IsNull(), drainUntil: IsNull() } });
      const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
      const volumes = await manager.getRepository(VolumePlacementEntity).find();
      const placedOf = (id: string) => placements.filter((p) => serviceId(p.project, p.deployment, p.service) === id);
      // Capacity is judged on what runs, with every service at its placed count.
      const capacity: CapacityInput = {
        // Reachability by the wall clock (heartbeats), whatever `now` the evaluation uses.
        nodes: toSchedulerNodes(plannerNodes(nodes)),
        // Scale-ups follow the planner's egress steering (M6 gate): new replicas only on agents with egress-policies.
        services: withEgressFeatureRequirements(
          toSchedulerServices(parsed),
          unfoldableEgressServices(parsed, resources),
        ).map((s) => ({ ...s, replicas: placedOf(s.id).length })),
        current: {
          replicas: placements.map((p) => ({
            service: serviceId(p.project, p.deployment, p.service),
            replica: p.id,
            node: p.node,
          })),
          volumes: volumes.map((v) => ({
            volume: v.id,
            primary: v.primaryNode,
            syncReplicas: v.syncReplicas,
            remoteReplicas: v.remoteReplicas,
          })),
        },
      };
      const usage = projectUsage(parsed, resources, backupBytes, 'current');
      const quotas = new Map(
        resources
          .filter((r) => r.kind === 'Project')
          .map((r) => [r.name, projectSpecSchema.parse(r.spec).quota] as const),
      );
      const specs = new Map(
        parsed.flatMap((d) => d.compose.services.map((s) => [serviceId(d.project, d.name, s.name), s] as const)),
      );
      const taken: AutoscaleAction[] = [];

      for (const a of autoscaled) {
        const spec = specs.get(a.id) as ServiceSpec;
        const placed = placedOf(a.id);
        const action = await this.evaluate(manager, {
          a,
          spec,
          placed,
          state: states.get(a.id) ?? null,
          capacity,
          usage: usage.get(a.project),
          quota: quotas.get(a.project),
          now,
        });

        if (!action) continue;

        taken.push(action);

        // Later services of this tick see the new layout and usage.
        const after = await manager
          .getRepository(WorkloadPlacementEntity)
          .find({ where: { cronRun: IsNull(), drainUntil: IsNull() } });
        const delta = action.to - action.from;
        const u = usage.get(a.project);

        placements.splice(0, placements.length, ...after);
        capacity.current = {
          ...capacity.current,
          replicas: after.map((p) => ({
            service: serviceId(p.project, p.deployment, p.service),
            replica: p.id,
            node: p.node,
          })),
        };
        capacity.services = capacity.services.map((s) =>
          s.id === a.id ? { ...s, replicas: placedOf(a.id).length } : s,
        );

        if (u) {
          u.cpuMillis += delta * spec.resources.requests.cpuMillis;
          u.memoryBytes += delta * spec.resources.requests.memoryBytes;
        }
      }

      return taken;
    });

    if (actions.length > 0) this.network.requestRecompile('autoscaler');

    return actions;
  }

  private async evaluate(
    manager: EntityManager,
    input: {
      a: AutoscaledService;
      spec: ServiceSpec;
      placed: WorkloadPlacementEntity[];
      state: AutoscaleStateEntity | null;
      capacity: CapacityInput;
      usage: ProjectUsage | undefined;
      quota: ReturnType<typeof projectSpecSchema.parse>['quota'];
      now: number;
    },
  ): Promise<AutoscaleAction | null> {
    const { a, spec, placed, now } = input;
    const repo = manager.getRepository(AutoscaleStateEntity);
    const state =
      input.state ??
      repo.create({
        serviceKey: a.id,
        project: a.project,
        replicas: a.replicas,
        lastScaleAt: null,
        lastReason: null,
        lastValue: null,
        recommendations: [],
        status: null,
      });
    const current = placed.length;
    const status = (patch: Partial<AutoscaleStatus> & Pick<AutoscaleStatus, 'action' | 'reason'>): AutoscaleStatus => ({
      metric: metricName(a.spec),
      target: a.spec.target,
      min: a.spec.min,
      max: a.spec.max,
      value: null,
      desired: current,
      blocked: null,
      atMax: false,
      evaluatedAt: new Date(now).toISOString(),
      ...patch,
    });
    const hold = async (reason: string) => {
      state.status = status({ action: 'hold', reason });
      await repo.save(state);

      return null;
    };

    if (current === 0) return await hold('holding: no replicas placed yet (the deployment is not applied)');

    // Blue / green-safe: nothing is added or removed while a replica of the service moves.
    if (placed.some((p) => p.migration || p.targetNode)) return await hold('holding: a replica is migrating');

    const measured = await this.read(manager, a, spec, placed, now);
    // Four decimals are plenty for decisions and keep reasons readable (0.025 cores of 0.25 = 10 %, not 10.000…2).
    const reading = {
      ...measured,
      value: measured.value === null ? null : Math.round(measured.value * 10_000) / 10_000,
    };
    const rec = recommend(
      {
        spec: a.spec,
        current,
        value: reading.value,
        missing: reading.missing,
        now,
        window: state.recommendations ?? [],
        lastScaleAt: state.lastScaleAt?.getTime() ?? null,
      },
      this.timing,
    );
    let to = rec.desired;
    let blocked: string | null = null;
    let added: ReplicaPlacement[] = [];

    if (rec.action === 'up') {
      const limit = largestAllowed(
        current,
        rec.desired,
        (n) =>
          quotaBlock(a.project, input.quota, input.usage, spec.resources.requests, n - current) ??
          placeScaleUp(input.capacity, a.id, n).issue,
      );

      to = limit.replicas;
      blocked = limit.blocked;

      if (to > current) added = placeScaleUp(input.capacity, a.id, to).added;
    }

    // Wanted more than max allows: reported like a blocked scale-up (alert, inbox).
    if (!blocked && rec.atMax && to >= a.spec.max) blocked = `at max ${a.spec.max} replicas`;

    state.recommendations = rec.window;
    state.status = status({
      action: to > current ? 'up' : to < current ? 'down' : 'hold',
      reason: rec.reason,
      value: reading.value,
      desired: rec.recommendation ?? current,
      blocked,
      atMax: rec.atMax,
    });

    if (to === current || (to > current && added.length !== to - current)) {
      state.replicas = current;
      await repo.save(state);

      return null;
    }

    const from = current;
    const reason = `${from} → ${to}: ${reading.value === null ? rec.reason : describeMetric(a.spec, reading.value)}${blocked ? ` (limited: ${blocked})` : ''}`;
    const placementRepo = manager.getRepository(WorkloadPlacementEntity);

    if (to > from) {
      for (const r of added) {
        // A replica of an earlier scale-down still draining: kept where it runs, else its drain is cut short.
        const draining = await placementRepo.findOne({ where: { id: r.replica } });

        if (draining && isDraining(draining) && draining.node === r.node) {
          await placementRepo.update({ id: r.replica }, { drainUntil: null });
          continue;
        }

        if (draining && isDraining(draining)) await placementRepo.delete({ id: r.replica });

        const addresses = await this.planner.allocateOn(manager, r.replica, a.id, r.node);

        await placementRepo.save(
          placementRepo.create({
            id: r.replica,
            project: a.project,
            deployment: a.deployment,
            service: a.service,
            node: r.node,
            addresses,
            targetNode: null,
            targetAddresses: [],
            migration: null,
            restored: null,
            gate: null,
            releasedSpec: null,
            cronRun: null,
            drainUntil: null,
            specHash: null,
            status: null,
          }),
        );
      }
    } else {
      // Newest first; out of routing now, stopped after the service's grace period (drain controller).
      const drainUntil = drainDeadline({ drainUntil: null }, spec?.stopGracePeriodMs, new Date());

      for (const id of replicasToRemove(
        placed.map((p) => p.id),
        to,
      ))
        await placementRepo.update({ id }, { drainUntil });
    }

    Object.assign(state, {
      replicas: to,
      lastScaleAt: new Date(now),
      lastReason: reason.slice(0, 2000),
      lastValue: reading.value,
    });
    await repo.save(state);
    await this.audit.record(manager, {
      actor: { type: 'system' },
      action: 'workload.autoscaled',
      target: `service/${a.id}`,
      project: a.project,
      details: {
        from,
        to,
        metric: metricName(a.spec),
        value: reading.value,
        target: a.spec.target,
        reason: rec.reason,
        ...(blocked ? { blocked } : {}),
        ...(to > from ? { added: added.map((r) => ({ replica: r.replica, node: r.node })) } : {}),
      },
    });
    await manager.query(`INSERT INTO lw_events (kind, entity, project, message, data) VALUES ($1, $2, $3, $4, $5)`, [
      'autoscale',
      a.id.slice(0, 255),
      a.project,
      `${a.id} scaled ${reason}`.slice(0, 4000),
      JSON.stringify({ from, to, metric: metricName(a.spec), value: reading.value, target: a.spec.target, blocked }),
    ]);

    return { service: a.id, from, to, reason };
  }

  /** The service's metric over the last minute (3.23); null with a reason when it is missing. */
  private async read(
    manager: EntityManager,
    a: AutoscaledService,
    spec: ServiceSpec,
    placed: readonly WorkloadPlacementEntity[],
    now: number,
  ): Promise<MetricReading> {
    const since = new Date(now - METRIC_WINDOW_MS);
    const replicas = placed.map((p) => p.id);
    const perReplica = async (metric: string) => {
      const rows: { entity: string; v: string }[] = await manager.query(
        `SELECT entity, avg(value) AS v FROM lw_metrics
          WHERE metric = $1 AND entity = ANY($2) AND "time" > $3 AND "time" <= $4 GROUP BY entity`,
        [metric, replicas, since, new Date(now)],
      );

      return rows.map((r) => Number(r.v));
    };
    const perHost = async (metric: string) => {
      const hosts = [...new Set(spec.http.map((h) => h.host))];

      if (hosts.length === 0) return [];

      const params: unknown[] = [metric, since, new Date(now)];
      const clauses = hosts.map((h) => {
        const p = hostPattern(h);

        params.push(p.value);

        return p.like ? `entity LIKE $${params.length}` : `entity = $${params.length}`;
      });
      // Per ingress node and hostname: the average of the window; the caller combines them.
      const rows: { v: string }[] = await manager.query(
        `SELECT avg(value) AS v FROM lw_metrics
          WHERE metric = $1 AND "time" > $2 AND "time" <= $3 AND (${clauses.join(' OR ')})
          GROUP BY node, entity`,
        params,
      );

      return rows.map((r) => Number(r.v));
    };

    switch (a.spec.metric) {
      case 'cpu':
      case 'memory': {
        const metric = a.spec.metric === 'cpu' ? 'replica.cpu_cores' : 'replica.memory_bytes';
        const request =
          a.spec.metric === 'cpu' ? spec.resources.requests.cpuMillis / 1000 : spec.resources.requests.memoryBytes;
        const values = await perReplica(metric);

        if (values.length === 0 || request <= 0)
          return { value: null, missing: `no ${a.spec.metric} samples of its replicas in the last minute` };

        return { value: (average(values) as number) * (100 / request) };
      }
      case 'requests': {
        const values = await perHost('ingress.requests_per_s');

        if (values.length > 0) return { value: values.reduce((x, y) => x + y, 0) / placed.length };

        // Ingress nodes only report hostnames with traffic: no samples while metrics flow = no requests.
        const [alive] = await manager.query(
          `SELECT 1 FROM lw_metrics WHERE metric LIKE 'node.%' AND "time" > $1 AND "time" <= $2 LIMIT 1`,
          [since, new Date(now)],
        );

        return alive ? { value: 0 } : { value: null, missing: 'no metrics reported by any node in the last minute' };
      }
      default: {
        const metric = a.spec.customMetric as string;
        const ofReplicas = await perReplica(metric);

        if (ofReplicas.length > 0) return { value: average(ofReplicas) };

        const ofHosts = combineHostValues(metric, await perHost(metric));

        if (ofHosts !== null) return { value: ofHosts };

        const [service]: { v: string | null }[] = await manager.query(
          `SELECT avg(value) AS v FROM lw_metrics WHERE metric = $1 AND entity = $2 AND "time" > $3 AND "time" <= $4`,
          [metric, a.id, since, new Date(now)],
        );

        return service?.v !== null && service?.v !== undefined
          ? { value: Number(service.v) }
          : {
              value: null,
              missing: `no ${metric} samples for the service, its replicas or hostnames in the last minute`,
            };
      }
    }
  }

  /** Autoscaled services the caller may read (3.17), with their current state (`GET /autoscaling`). */
  async list(req: RequestWithUser | undefined, project?: string): Promise<AutoscalingDto[]> {
    const caller = await this.access.caller(req);

    if (project && !canReadProject(caller, project)) throw new NotFoundException('project not found');

    return await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const resources = await manager
        .getRepository(ResourceEntity)
        .find({ where: [{ kind: 'Project' }, { kind: 'Deployment', ...(project ? { project } : {}) }] });
      const { autoscaled } = await this.planner.parseAutoscaled(manager, resources);
      const visible = autoscaled.filter(
        (a) => canReadProject(caller, a.project) && (!project || a.project === project),
      );

      if (visible.length === 0) return [];

      const states = new Map(
        (await manager.getRepository(AutoscaleStateEntity).find()).map((s) => [s.serviceKey, s] as const),
      );
      const counts: { project: string; deployment: string; service: string; n: string }[] = await manager.query(
        `SELECT project, deployment, service, count(*) AS n FROM lw_workload_placements
          WHERE cron_run IS NULL AND drain_until IS NULL GROUP BY project, deployment, service`,
      );
      const placed = new Map(counts.map((c) => [serviceId(c.project, c.deployment, c.service), Number(c.n)]));

      return visible
        .map((a): AutoscalingDto => {
          const state = states.get(a.id);

          return {
            id: a.id,
            project: a.project,
            deployment: a.deployment,
            service: a.service,
            min: a.spec.min,
            max: a.spec.max,
            metric: a.spec.metric,
            customMetric: a.spec.customMetric ?? null,
            target: a.spec.target,
            replicas: placed.get(a.id) ?? 0,
            desiredReplicas: a.replicas,
            status: state?.status ?? null,
            lastScaleAt: state?.lastScaleAt?.toISOString() ?? null,
            lastReason: state?.lastReason ?? null,
            lastValue: state?.lastValue ?? null,
          };
        })
        .sort((x, y) => x.id.localeCompare(y.id));
    });
  }
}

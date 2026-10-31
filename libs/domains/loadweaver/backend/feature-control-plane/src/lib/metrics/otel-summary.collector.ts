import { isOtelEffectivelyEnabled, resolveOtelRuntimeConfig, setGauge } from '@forepath/shared/backend/util-otel';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { liveOpenAlerts } from '../alerts/alert.service';
import { NodeEntity } from '../entities/node.entity';
import { nodeConnectedInCluster } from '../services/nodes.service';

const METER = 'loadweaver.cluster';
const INTERVAL_MS = 30_000;
const LIFECYCLES = ['active', 'cordoned', 'draining', 'leaving'] as const;
const PLAN_STATUSES = ['pending', 'applying', 'rolling-back', 'rollback-failed'] as const;
const SEVERITIES = ['info', 'warning', 'critical'] as const;
const RESOURCES = ['cpuMillis', 'memoryBytes', 'diskBytes'] as const;

function sum<T>(items: readonly T[], value: (item: T) => number | undefined): number {
  return items.reduce((total, item) => total + (Number(value(item)) || 0), 0);
}

/**
 * Cluster summary for the shared OpenTelemetry module (3.18: its Prometheus endpoint and OTLP push): nodes by
 * lifecycle and connection, open plans by status, firing alerts by severity, capacity and usage. Only fixed label
 * sets, so no series goes stale; per-series data is scraped from `GET /metrics/prometheus`, scoped by access.
 */
@Injectable()
export class OtelSummaryCollector implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OtelSummaryCollector.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    if (!isOtelEffectivelyEnabled(resolveOtelRuntimeConfig())) return;

    void this.collect();
    this.timer = setInterval(() => void this.collect(), INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async collect(): Promise<void> {
    try {
      // Connected = a fresh heartbeat, like the nodes list (the `connected` column alone stays true for a node whose
      // stream died without a clean close, and freezes during the read-only fallback; 2026-10-31).
      const now = Date.now();
      const nodes = (
        await this.dataSource.getRepository(NodeEntity).find({
          where: { lifecycle: Not('left') },
          select: { name: true, lifecycle: true, connected: true, lastSeenAt: true, capacity: true, usage: true },
        })
      ).map((n) => ({ ...n, connected: nodeConnectedInCluster(n, now) }));

      for (const lifecycle of LIFECYCLES)
        for (const connected of [true, false])
          setGauge(
            METER,
            'loadweaver.nodes',
            nodes.filter((r) => r.lifecycle === lifecycle && r.connected === connected).length,
            { lifecycle, connected: String(connected) },
          );

      const plans: { status: string; n: number }[] = await this.dataSource.query(
        `SELECT status, count(*)::int AS n FROM lw_plans WHERE status = ANY($1) GROUP BY 1`,
        [PLAN_STATUSES],
      );

      for (const status of PLAN_STATUSES)
        setGauge(METER, 'loadweaver.plans', plans.find((r) => r.status === status)?.n ?? 0, { status });

      // Read-only fallback (3.43): the live evaluation instead of the frozen rows.
      const live = liveOpenAlerts();
      const alerts: { severity: string; n: number }[] = live
        ? SEVERITIES.map((severity) => ({
            severity,
            n: live.filter((a) => a.state === 'firing' && a.severity === severity).length,
          }))
        : await this.dataSource.query(
            `SELECT severity, count(*)::int AS n FROM lw_alerts WHERE state = 'firing' GROUP BY 1`,
          );

      for (const severity of SEVERITIES)
        setGauge(METER, 'loadweaver.alerts.firing', alerts.find((r) => r.severity === severity)?.n ?? 0, { severity });

      // Capacity and usage of the nodes that are up (as the cluster overview, 2026-10-31): an offline node's last
      // report says nothing about now.
      const up = nodes.filter((n) => n.connected);

      for (const resource of RESOURCES) {
        setGauge(
          METER,
          'loadweaver.capacity',
          sum(up, (n) => n.capacity?.[resource]),
          { resource },
        );
        setGauge(
          METER,
          'loadweaver.usage',
          sum(up, (n) => n.usage?.[resource]),
          { resource },
        );
      }
    } catch (error) {
      this.logger.debug(`Summary metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
